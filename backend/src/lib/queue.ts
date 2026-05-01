import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

// Create Redis connection for Upstash
// Upstash requires TLS (rediss://) 
const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: config.redisUrl.startsWith('rediss://') ? {} : undefined,
});

// Queue names
export const QUEUE_NAMES = {
  SCRAPER: 'scraper-queue',
  LLM: 'llm-queue',
  ENRICHMENT: 'enrichment-queue',
} as const;

// Create queues
export const scraperQueue = new Queue(QUEUE_NAMES.SCRAPER, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const llmQueue = new Queue(QUEUE_NAMES.LLM, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const enrichmentQueue = new Queue(QUEUE_NAMES.ENRICHMENT, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// Job data interfaces
export interface ScraperJobData {
  jobId: string;
  url: string;
  batchId: string;
}

export interface LLMJobData {
  jobId: string;
  url: string;
  batchId: string;
  scrapedText: string;
}

export interface EnrichmentJobData {
  jobId: string;
  url: string;
  batchId: string;
  companyName: string;
}

// Export connection for workers
export { connection };

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  await scraperQueue.close();
  await llmQueue.close();
  await enrichmentQueue.close();
  await connection.quit();
}