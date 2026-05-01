import { createScraperWorker } from './scraper.worker';
import { createLLMWorker } from './llm.worker';
import { createEnrichmentWorker } from './enrichment.worker';
import { closeQueues } from '../lib/queue';

console.log('[Workers] Starting all workers...');

const scraperWorker = createScraperWorker();
const llmWorker = createLLMWorker();
const enrichmentWorker = createEnrichmentWorker();

console.log('[Workers] All workers started successfully');
console.log('[Workers] Scraper: max concurrency 2');
console.log('[Workers] LLM: max concurrency 3');
console.log('[Workers] Enrichment: max concurrency 5');

// Graceful shutdown
async function shutdown() {
  console.log('[Workers] Shutting down gracefully...');
  
  await scraperWorker.close();
  await llmWorker.close();
  await enrichmentWorker.close();
  await closeQueues();
  
  console.log('[Workers] All workers stopped');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);