import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { scraperQueue } from '../lib/queue';

const router = Router();

// POST /api/ingest - Receive URLs and enqueue for processing
router.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: 'Request body must contain a non-empty "urls" array' });
      return;
    }

    // Validate URLs
    const validUrls: string[] = [];
    const invalidUrls: string[] = [];

    for (const url of urls) {
      try {
        new URL(url.trim());
        validUrls.push(url.trim());
      } catch {
        invalidUrls.push(url);
      }
    }

    if (validUrls.length === 0) {
      res.status(400).json({ error: 'No valid URLs provided', invalidUrls });
      return;
    }

    const batchId = uuidv4();

    // Create database records for each URL
    const jobRecords = validUrls.map(url => ({
      id: uuidv4(),
      batch_id: batchId,
      url,
      status: 'pending' as const,
    }));

    const { error: insertError } = await supabase
      .from('lead_jobs')
      .insert(jobRecords);

    if (insertError) {
      console.error('[Ingest] Database insert error:', insertError);
      res.status(500).json({ error: 'Failed to create job records' });
      return;
    }

    // Enqueue each URL into the scraper queue
    for (const record of jobRecords) {
      await scraperQueue.add('scrape', {
        jobId: record.id,
        url: record.url,
        batchId: record.batch_id,
      });
    }

    console.log(`[Ingest] Batch ${batchId}: enqueued ${validUrls.length} URLs`);

    res.status(201).json({
      batchId,
      totalJobs: validUrls.length,
      invalidUrls: invalidUrls.length > 0 ? invalidUrls : undefined,
      jobs: jobRecords.map(j => ({ id: j.id, url: j.url, status: j.status })),
    });
  } catch (error: any) {
    console.error('[Ingest] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/status/:batchId - Get status of all jobs in a batch
router.get('/status/:batchId', async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const { data, error } = await supabase
      .from('lead_jobs')
      .select('id, url, status, error, created_at, updated_at')
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

    // Compute summary
    const summary = {
      total: data.length,
      pending: data.filter(j => j.status === 'pending').length,
      scraping: data.filter(j => j.status === 'scraping').length,
      analyzing: data.filter(j => j.status === 'analyzing').length,
      enriching: data.filter(j => j.status === 'enriching').length,
      completed: data.filter(j => j.status === 'completed').length,
      failed: data.filter(j => j.status === 'failed').length,
    };

    res.json({ batchId, summary, jobs: data });
  } catch (error: any) {
    console.error('[Status] Error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/results/:batchId - Get completed results for a batch
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

    const results = data.map(job => ({
      id: job.id,
      url: job.url,
      status: job.status,
      company_name: job.llm_result?.company_name || null,
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

// GET /api/health - Health check endpoint (no auth required)
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;