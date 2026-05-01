import { Worker, Job } from 'bullmq';
import { chromium, Browser, Route } from 'playwright';
import { config } from '../config';
import { supabase } from '../lib/supabase';
import { connection, llmQueue, ScraperJobData } from '../lib/queue';

// Semaphore to limit concurrent browser instances to 2
let activeBrowsers = 0;
const MAX_BROWSERS = config.scraper.maxConcurrency;

// Blocked resource types and URL patterns for aggressive asset blocking
const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font', 'stylesheet'];
const BLOCKED_URL_PATTERNS = [
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /facebook\.net/,
  /doubleclick\.net/,
  /hotjar\.com/,
  /segment\.com/,
  /mixpanel\.com/,
  /amplitude\.com/,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.svg$/i,
  /\.webp$/i,
  /\.woff2?$/i,
  /\.ttf$/i,
  /\.eot$/i,
  /\.mp4$/i,
  /\.webm$/i,
  /\.mp3$/i,
];

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

function stripNavAndFooter(html: string): string {
  // Remove common nav/header/footer patterns
  let cleaned = html;
  
  // Remove <nav> elements
  cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  // Remove <header> elements
  cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, '');
  // Remove <footer> elements
  cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // Remove <aside> elements (sidebars)
  cleaned = cleaned.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  // Remove script tags
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove style tags
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove noscript tags
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Remove all HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

async function scrapeUrl(url: string): Promise<string> {
  const proxyUrl = `http://${config.brightData.username}:${config.brightData.password}@${config.brightData.host}:${config.brightData.port}`;
  
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: config.brightData.username ? { server: proxyUrl } : undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      javaScriptEnabled: true,
    });

    const page = await context.newPage();

    // Aggressive network interception - block non-essential assets
    await page.route('**/*', (route: Route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // Block by resource type
      if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
        return route.abort();
      }

      // Block by URL pattern (tracking scripts, media files)
      if (BLOCKED_URL_PATTERNS.some(pattern => pattern.test(requestUrl))) {
        return route.abort();
      }

      return route.continue();
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.scraper.navigationTimeout,
    });

    // Wait briefly for dynamic content
    await page.waitForTimeout(2000);

    // Extract the page HTML (runs in browser context)
    const bodyHtml = await page.evaluate(() => {
      return (globalThis as any).document?.body?.innerHTML || '';
    });

    await context.close();

    // Strip structural elements and extract text
    const cleanText = stripNavAndFooter(bodyHtml);
    
    // Truncate to max word count
    const truncated = truncateToWordLimit(cleanText, config.scraper.maxWordCount);

    return truncated;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Create the scraper worker
export function createScraperWorker(): Worker<ScraperJobData> {
  const worker = new Worker<ScraperJobData>(
    'scraper-queue',
    async (job: Job<ScraperJobData>) => {
      const { jobId, url, batchId } = job.data;
      
      console.log(`[Scraper] Processing job ${jobId}: ${url}`);

      // Update status to scraping
      await supabase
        .from('lead_jobs')
        .update({ status: 'scraping', updated_at: new Date().toISOString() })
        .eq('id', jobId);

      try {
        const scrapedText = await scrapeUrl(url);

        if (!scrapedText || scrapedText.length < 50) {
          throw new Error('Insufficient text content extracted from page');
        }

        // Save scraped text to database
        await supabase
          .from('lead_jobs')
          .update({
            scraped_text: scrapedText,
            status: 'analyzing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        // Enqueue LLM analysis job
        await llmQueue.add('analyze', {
          jobId,
          url,
          batchId,
          scrapedText,
        });

        console.log(`[Scraper] Completed job ${jobId}, enqueued for LLM analysis`);
      } catch (error: any) {
        console.error(`[Scraper] Failed job ${jobId}:`, error.message);

        await supabase
          .from('lead_jobs')
          .update({
            status: 'failed',
            error: `Scraping failed: ${error.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        throw error;
      }
    },
    {
      connection,
      concurrency: MAX_BROWSERS, // Max 2 concurrent browser instances
      limiter: {
        max: MAX_BROWSERS,
        duration: 1000,
      },
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Scraper] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Scraper] Job ${job.id} completed`);
  });

  return worker;
}