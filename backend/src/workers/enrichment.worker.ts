import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { supabase } from '../lib/supabase';
import { connection } from '../lib/queue';

interface Contact {
  name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  source: string;
  address: string | null;
  rating: number | null;
  website: string | null;
}

interface EnrichmentJobData {
  jobId: string;
  url: string;
  batchId: string;
  companyName: string;
}

function extractRootDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

function extractCompanyShortName(companyName: string): string {
  // Remove common suffixes for better search results
  return companyName
    .replace(/\b(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|Company|Group|Holdings|International|Technologies|Solutions)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// --- Google Maps Places API (Text Search) ---
async function searchGoogleMaps(companyName: string, domain: string): Promise<Contact[]> {
  const apiKey = config.googleMapsApiKey;
  if (!apiKey) {
    console.log('[Enrichment] Google Maps API key not configured, skipping');
    return [];
  }

  try {
    const query = encodeURIComponent(`${companyName} ${domain}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Maps API error (${response.status})`);
    }

    const data = await response.json() as any;
    const results = data.results || [];

    const contacts: Contact[] = [];

    for (const place of results.slice(0, 3)) {
      // Get place details for phone number
      let phone: string | null = null;
      let website: string | null = null;

      if (place.place_id) {
        try {
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website,name&key=${apiKey}`;
          const detailsRes = await fetch(detailsUrl);
          if (detailsRes.ok) {
            const detailsData = await detailsRes.json() as any;
            phone = detailsData.result?.formatted_phone_number || null;
            website = detailsData.result?.website || null;
          }
        } catch (e) {
          // Skip details if they fail
        }
      }

      contacts.push({
        name: place.name || null,
        email: null, // Google Maps doesn't provide emails
        phone: phone,
        position: null,
        source: 'google_maps',
        address: place.formatted_address || null,
        rating: place.rating || null,
        website: website,
      });
    }

    return contacts;
  } catch (error: any) {
    console.error('[Enrichment] Google Maps search failed:', error.message);
    return [];
  }
}

// --- Yellow Pages Scraper (no API key needed) ---
async function searchYellowPages(companyName: string): Promise<Contact[]> {
  try {
    const searchName = extractCompanyShortName(companyName);
    const query = encodeURIComponent(searchName);
    const url = `https://www.yellowpages.com/search?search_terms=${query}&geo_location_terms=`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Yellow Pages HTTP error (${response.status})`);
    }

    const html = await response.text();
    const contacts: Contact[] = [];

    // Extract business listings from HTML using regex patterns
    // Yellow Pages uses structured data in their listings
    const businessBlocks = html.match(/<div class="v-card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || [];

    for (const block of businessBlocks.slice(0, 5)) {
      // Extract business name
      const nameMatch = block.match(/<a class="business-name"[^>]*>(?:<span>)?(.*?)(?:<\/span>)?<\/a>/i);
      const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : null;

      // Extract phone
      const phoneMatch = block.match(/<div class="phones[^"]*"[^>]*>(.*?)<\/div>/i);
      const phone = phoneMatch ? phoneMatch[1].replace(/<[^>]+>/g, '').trim() : null;

      // Extract address
      const streetMatch = block.match(/<div class="street-address">(.*?)<\/div>/i);
      const localityMatch = block.match(/<div class="locality">(.*?)<\/div>/i);
      const street = streetMatch ? streetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const locality = localityMatch ? localityMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const address = [street, locality].filter(Boolean).join(', ') || null;

      // Extract website link
      const websiteMatch = block.match(/href="(https?:\/\/[^"]*)"[^>]*class="[^"]*track-visit-website/i);
      const website = websiteMatch ? websiteMatch[1] : null;

      if (name) {
        contacts.push({
          name,
          email: null,
          phone,
          position: null,
          source: 'yellow_pages',
          address,
          rating: null,
          website,
        });
      }
    }

    return contacts;
  } catch (error: any) {
    console.error('[Enrichment] Yellow Pages search failed:', error.message);
    return [];
  }
}

// --- Combined enrichment ---
async function enrichCompany(companyName: string, url: string): Promise<Contact[]> {
  const domain = extractRootDomain(url);
  
  // Run both searches in parallel
  const [googleContacts, ypContacts] = await Promise.all([
    searchGoogleMaps(companyName, domain),
    searchYellowPages(companyName),
  ]);

  // Merge and deduplicate by name
  const allContacts = [...googleContacts, ...ypContacts];
  const seen = new Set<string>();
  const unique: Contact[] = [];

  for (const contact of allContacts) {
    const key = (contact.name || '').toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(contact);
    }
  }

  return unique;
}

export function createEnrichmentWorker() {
  const worker = new Worker<EnrichmentJobData>(
    'enrichment-queue',
    async (job: Job<EnrichmentJobData>) => {
      const { jobId, url, batchId, companyName } = job.data;
      console.log(`[Enrichment] Processing job ${jobId}: ${companyName} (${url})`);

      try {
        const contacts = await enrichCompany(companyName, url);

        // Save contacts and mark as completed
        await supabase
          .from('lead_jobs')
          .update({
            contacts: contacts,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        console.log(`[Enrichment] Completed job ${jobId}: found ${contacts.length} contacts for ${companyName}`);
      } catch (error: any) {
        console.error(`[Enrichment] Failed job ${jobId}:`, error.message);
        // Still mark as completed but with error note
        await supabase
          .from('lead_jobs')
          .update({
            contacts: [],
            status: 'completed',
            error: `Enrichment partial failure: ${error.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Enrichment] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Enrichment] Job ${job.id} completed`);
  });

  return worker;
}