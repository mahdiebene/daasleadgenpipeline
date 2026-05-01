import { Worker, Job } from 'bullmq';
import { config } from '../config';
import { supabase, LLMResult } from '../lib/supabase';
import { connection, enrichmentQueue, LLMJobData } from '../lib/queue';

const SYSTEM_PROMPT = `You are a B2B data intelligence analyst. Your task is to analyze a company's website content and produce a structured lead generation report.

You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation text.

The JSON object must have exactly these fields:
{
  "company_name": "The company's name extracted from the content",
  "core_focus": "A 1-2 sentence summary of what the company does",
  "data_vulnerabilities": ["Array of 2-4 specific data gaps, blind spots, or intelligence weaknesses the company likely has based on their business model"],
  "recommended_dataset": "A specific dataset product/offering that would address their most critical data vulnerability",
  "cold_email_hook": "A 2-3 sentence cold email opening that references their specific situation and pitches the recommended dataset. Make it personalized and compelling."
}

Rules:
- Be specific, not generic. Reference actual details from the content.
- data_vulnerabilities should identify real gaps where external data could help them.
- recommended_dataset should be a concrete data product (e.g., "Real-time competitor pricing feeds", "Intent data for enterprise buyers in healthcare")
- cold_email_hook should feel personalized and reference something specific about the company.
- Output ONLY the JSON object. Any other text will cause a system failure.`;

async function callClaudeAPI(scrapedText: string): Promise<LLMResult> {
  // Use Pollination's OpenAI-compatible API for Claude access
  // Falls back to direct Anthropic API if ANTHROPIC_API_KEY is set
  const usePollinationAPI = !config.anthropicApiKey || config.anthropicApiKey === 'pollination';
  
  let responseText: string;

  if (usePollinationAPI) {
    // Pollination API (OpenAI-compatible, free Claude access)
    const response = await fetch('https://text.pollinations.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Analyze the following company website content and produce the lead intelligence JSON report:\n\n${scrapedText}`,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Pollination API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as any;
    responseText = data.choices?.[0]?.message?.content || '';
    
    if (!responseText) {
      throw new Error('No content in Pollination API response');
    }
  } else {
    // Direct Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Analyze the following company website content and produce the lead intelligence JSON report:\n\n${scrapedText}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Claude API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as any;
    const textContent = data.content?.find((block: any) => block.type === 'text');
    if (!textContent?.text) {
      throw new Error('No text content in Claude API response');
    }
    responseText = textContent.text;
  }

  // Parse the JSON response
  let parsed: LLMResult;
  try {
    let jsonStr = responseText.trim();
    
    // Remove markdown code fences if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    parsed = JSON.parse(jsonStr);
  } catch (parseError: any) {
    throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}\nRaw: ${responseText.substring(0, 200)}`);
  }

  // Validate required fields
  if (!parsed.company_name || !parsed.core_focus || !parsed.data_vulnerabilities || 
      !parsed.recommended_dataset || !parsed.cold_email_hook) {
    throw new Error('LLM response missing required fields');
  }

  return parsed;
}

export function createLLMWorker(): Worker<LLMJobData> {
  const worker = new Worker<LLMJobData>(
    'llm-queue',
    async (job: Job<LLMJobData>) => {
      const { jobId, url, batchId, scrapedText } = job.data;

      console.log(`[LLM] Processing job ${jobId}: ${url}`);

      try {
        const llmResult = await callClaudeAPI(scrapedText);

        // Save LLM result and update status
        await supabase
          .from('lead_jobs')
          .update({
            llm_result: llmResult as any,
            status: 'enriching',
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        // Enqueue enrichment job
        await enrichmentQueue.add('enrich', {
          jobId,
          url,
          batchId,
          companyName: llmResult.company_name,
        });

        console.log(`[LLM] Completed job ${jobId}, enqueued for enrichment`);
      } catch (error: any) {
        console.error(`[LLM] Failed job ${jobId}:`, error.message);

        await supabase
          .from('lead_jobs')
          .update({
            status: 'failed',
            error: `LLM analysis failed: ${error.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        throw error;
      }
    },
    {
      connection,
      concurrency: 3, // Can handle more concurrent LLM calls since they're API-bound
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[LLM] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[LLM] Job ${job.id} completed`);
  });

  return worker;
}