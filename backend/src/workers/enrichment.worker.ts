import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { supabase, HunterContact } from '../lib/supabase';
import { connection, EnrichmentJobData } from '../lib/queue';

// Target roles for decision-makers
const TARGET_SENIORITIES = ['senior', 'executive', 'c-level'];
const TARGET_DEPARTMENTS = ['engineering', 'it', 'executive', 'management'];
const TARGET_POSITIONS_REGEX = /\b(founder|co-founder|cto|ceo|coo|chief.*officer|vp.*eng|head.*eng|lead.*eng|director.*eng|principal.*eng|tech.*lead)\b/i;

function extractRootDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Get root domain (e.g., "sub.example.com" -> "example.com")
    const parts = parsed.hostname.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

async function queryHunterIO(domain: string): Promise<HunterContact[]> {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${config.hunterApiKey}&limit=20`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Hunter.io API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as any;
  const emails = data?.data?.emails || [];

  // Filter for technical decision-makers
  const relevantContacts: HunterContact[] = emails
    .filter((email: any) => {
      const position = (email.position || '').toLowerCase();
      const seniority = (email.seniority || '').toLowerCase();
      const department = (email.department || '').toLowerCase();

      // Match by position title
      if (TARGET_POSITIONS_REGEX.test(position)) return true;

      // Match by seniority + department combo
      if (TARGET_SENIORITIES.includes(seniority) && TARGET_DEPARTMENTS.includes(department)) return true;

      return false;
    })
    .map((email: any) => ({
      email: email.value,
      first_name: email.first_name || null,
      last_name: email.last_name || null,
      position: email.position || null,
      department: email.department || null,
      linkedin: email.linkedin || null,
    }));

  return relevantContacts;
}

export function createEnrichmentWorker(): Worker<EnrichmentJobData> {
  const worker = new Worker<EnrichmentJobData>(
    'enrichment-queue',
    async (job: Job<EnrichmentJobData>) => {
      const { jobId, url, batchId } = job.data;

      console.log(`[Enrichment] Processing job ${jobId}: ${url}`);

      try {
        const domain = extractRootDomain(url);
        const contacts = await queryHunterIO(domain);

        // Save contacts and mark as completed
        await supabase
          .from('lead_jobs')
          .update({
            contacts: contacts as any,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        console.log(`[Enrichment] Completed job ${jobId}: found ${contacts.length} contacts for ${domain}`);
      } catch (error: any) {
        console.error(`[Enrichment] Failed job ${jobId}:`, error.message);

        // Still mark as completed but with error note - enrichment failure shouldn't block results
        await supabase
          .from('lead_jobs')
          .update({
            contacts: [] as any,
            status: 'completed',
            error: `Enrichment partial failure: ${error.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }
    },
    {
      connection,
      concurrency: 5, // Hunter.io API calls are lightweight
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