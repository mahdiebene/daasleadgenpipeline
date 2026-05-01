import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { scraperQueue } from '../lib/queue';
import { config } from '../config';
import { chromium, Browser } from 'playwright';

const router = Router();

// ─── Directory search via Playwright + Bing (routed through Bright Data proxy) ───
interface DirectoryBusiness {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
}

let browserInstance: Browser | null = null;

function getProxyConfig() {
  const { host, port, username, password } = config.brightData;
  if (username && password) {
    return {
      server: `http://${host}:${port}`,
      username,
      password,
    };
  }
  return undefined;
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  const proxy = getProxyConfig();
  browserInstance = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    ...(proxy ? { proxy } : {}),
  });
  return browserInstance;
}

async function searchDirectory(niche: string, location: string): Promise<DirectoryBusiness[]> {
  console.log(`[Directory] Searching Bing for: ${niche} in ${location}`);

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  // Block non-essential assets to save bandwidth & RAM
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  const businesses: DirectoryBusiness[] = [];

  try {
    const query = encodeURIComponent(`${niche} ${location}`);
    const bingUrl = `https://www.bing.com/search?q=${query}&count=30`;

    await page.goto(bingUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000);

    // Extract organic search results from Bing
    const results = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];
      document.querySelectorAll('li.b_algo').forEach((el) => {
        const linkEl = el.querySelector('h2 a') as HTMLAnchorElement | null;
        const snippetEl = el.querySelector('.b_caption p, .b_lineclamp2');
        if (linkEl) {
          items.push({
            title: linkEl.textContent?.trim() || '',
            url: linkEl.href || '',
            snippet: snippetEl?.textContent?.trim() || '',
          });
        }
      });
      return items;
    });

    console.log(`[Directory] Bing returned ${results.length} raw results`);

    // Filter out aggregator/directory sites — keep actual business websites
    const skipDomains = [
      'yelp.com', 'yellowpages.com', 'bbb.org', 'facebook.com', 'twitter.com',
      'instagram.com', 'youtube.com', 'wikipedia.org', 'mapquest.com', 'thumbtack.com',
      'angi.com', 'homeadvisor.com', 'nextdoor.com', 'linkedin.com', 'pinterest.com',
      'reddit.com', 'tiktok.com', 'amazon.com', 'bing.com', 'microsoft.com',
    ];

    const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

    for (const result of results) {
      if (!result.url || !result.title) continue;
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        continue;
      }
      const hostname = url.hostname.toLowerCase();
      if (skipDomains.some((d) => hostname.includes(d))) continue;

      const phoneMatch = result.snippet.match(phoneRegex);
      businesses.push({
        name: result.title.replace(/\s*[-|–—].*$/, '').trim(),
        phone: phoneMatch ? phoneMatch[0] : null,
        address: null,
        website: result.url,
      });
    }

    // Deduplicate by domain
    const seen = new Set<string>();
    const unique = businesses.filter((b) => {
      if (!b.website) return true;
      try {
        const domain = new URL(b.website).hostname;
        if (seen.has(domain)) return false;
        seen.add(domain);
        return true;
      } catch {
        return true;
      }
    });

    console.log(`[Directory] Found ${unique.length} unique businesses after filtering`);
    return unique;
  } catch (error: any) {
    console.error(`[Directory] Search error:`, error.message);
    throw error;
  } finally {
    await page.close();
    await context.close();
  }
}

// ─── POST /api/ingest ───
// Accepts { niche, location } OR { urls: string[] } for backward compatibility
router.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { niche, location, urls } = req.body;

    // Legacy mode: accept raw URLs array
    if (urls && Array.isArray(urls)) {
      return handleUrlIngest(urls, res);
    }

    if (!niche || !location || typeof niche !== 'string' || typeof location !== 'string') {
      res.status(400).json({
        error: 'Request body must contain "niche" and "location" strings, or a "urls" array',
      });
      return;
    }

    // Search directory for businesses
    let businesses: DirectoryBusiness[];
    try {
      businesses = await searchDirectory(niche.trim(), location.trim());
    } catch (err: any) {
      console.error('[Ingest] Directory search failed:', err.message);
      res.status(502).json({ error: `Directory search failed: ${err.message}` });
      return;
    }

    if (businesses.length === 0) {
      res.status(404).json({
        error:
          'No businesses found. This may be because the search engine blocked the request from this server IP. Configure BRIGHTDATA_USERNAME and BRIGHTDATA_PASSWORD in .env to route through a residential proxy.',
      });
      return;
    }

    // Filter to businesses with valid website URLs
    const withWebsites = businesses.filter((b) => {
      if (!b.website) return false;
      try {
        new URL(b.website);
        return true;
      } catch {
        return false;
      }
    });

    const batchId = uuidv4();

    const jobRecords = withWebsites.map((biz) => ({
      id: uuidv4(),
      batch_id: batchId,
      url: biz.website!,
      status: 'pending' as const,
      business_name: biz.name,
      phone: biz.phone,
      address: biz.address,
      niche: niche.trim(),
      location: location.trim(),
    }));

    // Records for businesses without websites (directory-only data)
    const noWebsiteRecords = businesses
      .filter((b) => {
        if (!b.website) return true;
        try {
          new URL(b.website);
          return false;
        } catch {
          return true;
        }
      })
      .map((biz) => ({
        id: uuidv4(),
        batch_id: batchId,
        url: '',
        status: 'completed' as const,
        business_name: biz.name,
        phone: biz.phone,
        address: biz.address,
        niche: niche.trim(),
        location: location.trim(),
      }));

    const allRecords = [...jobRecords, ...noWebsiteRecords];

    if (allRecords.length > 0) {
      const { error: insertError } = await supabase.from('lead_jobs').insert(allRecords);
      if (insertError) {
        console.error('[Ingest] Database insert error:', insertError);
        res.status(500).json({ error: 'Failed to create job records' });
        return;
      }
    }

    for (const record of jobRecords) {
      await scraperQueue.add('scrape', {
        jobId: record.id,
        url: record.url,
        batchId: record.batch_id,
      });
    }

    console.log(
      `[Ingest] Batch ${batchId}: ${businesses.length} businesses found, ${jobRecords.length} enqueued`
    );

    res.status(201).json({
      batchId,
      totalBusinesses: businesses.length,
      totalWithWebsites: jobRecords.length,
      totalWithoutWebsites: noWebsiteRecords.length,
      jobs: allRecords.map((j) => ({
        id: j.id,
        url: j.url,
        status: j.status,
        business_name: j.business_name,
        phone: j.phone,
      })),
    });
  } catch (error: any) {
    console.error('[Ingest] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legacy URL-based ingest handler
async function handleUrlIngest(urls: string[], res: Response) {
  const validUrls = urls
    .map((u: string) => u.trim())
    .filter((u: string) => {
      try {
        new URL(u);
        return true;
      } catch {
        return false;
      }
    });

  if (validUrls.length === 0) {
    res.status(400).json({ error: 'No valid URLs provided' });
    return;
  }

  const batchId = uuidv4();
  const jobRecords = validUrls.map((url: string) => ({
    id: uuidv4(),
    batch_id: batchId,
    url,
    status: 'pending' as const,
  }));

  const { error: insertError } = await supabase.from('lead_jobs').insert(jobRecords);
  if (insertError) {
    console.error('[Ingest] Database insert error:', insertError);
    res.status(500).json({ error: 'Failed to create job records' });
    return;
  }

  for (const record of jobRecords) {
    await scraperQueue.add('scrape', {
      jobId: record.id,
      url: record.url,
      batchId: record.batch_id,
    });
  }

  console.log(`[Ingest] Batch ${batchId}: ${validUrls.length} URLs enqueued`);

  res.status(201).json({
    batchId,
    totalUrls: validUrls.length,
    jobs: jobRecords.map((j) => ({ id: j.id, url: j.url, status: j.status })),
  });
}

// ─── GET /api/status/:batchId ───
router.get('/status/:batchId', async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const { data, error } = await supabase
      .from('lead_jobs')
      .select('id, url, status, error, business_name, phone, address, created_at, updated_at')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Status] Database query error:', error);
      res.status(500).json({ error: 'Failed to fetch job statuses' });
      return;
    }

    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const summary = {
      total: data.length,
      pending: data.filter((j) => j.status === 'pending').length,
      scraping: data.filter((j) => j.status === 'scraping').length,
      analyzing: data.filter((j) => j.status === 'analyzing').length,
      enriching: data.filter((j) => j.status === 'enriching').length,
      completed: data.filter((j) => j.status === 'completed').length,
      failed: data.filter((j) => j.status === 'failed').length,
    };

    res.json({ batchId, summary, jobs: data });
  } catch (error: any) {
    console.error('[Status] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/results/:batchId ───
router.get('/results/:batchId', async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const { data, error } = await supabase
      .from('lead_jobs')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Results] Database query error:', error);
      res.status(500).json({ error: 'Failed to fetch results' });
      return;
    }

    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const results = data.map((job) => ({
      id: job.id,
      url: job.url,
      status: job.status,
      business_name: job.business_name || null,
      phone: job.phone || null,
      address: job.address || null,
      company_name: job.llm_result?.company_name || job.business_name || null,
      core_focus: job.llm_result?.core_focus || null,
      data_vulnerabilities: job.llm_result?.data_vulnerabilities || null,
      recommended_dataset: job.llm_result?.recommended_dataset || null,
      cold_email_hook: job.llm_result?.cold_email_hook || null,
      contacts: job.contacts || [],
      error: job.error || null,
    }));

    res.json({ batchId, results });
  } catch (error: any) {
    console.error('[Results] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/health ───
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;