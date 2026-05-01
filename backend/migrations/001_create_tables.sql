-- Run this in the Supabase SQL Editor to create the required tables

CREATE TABLE IF NOT EXISTS lead_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'scraping', 'analyzing', 'enriching', 'completed', 'failed')),
  scraped_text TEXT,
  llm_result JSONB,
  contacts JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for batch lookups
CREATE INDEX IF NOT EXISTS idx_lead_jobs_batch_id ON lead_jobs(batch_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_lead_jobs_status ON lead_jobs(status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_lead_jobs_updated_at
  BEFORE UPDATE ON lead_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, service key bypasses RLS)
ALTER TABLE lead_jobs ENABLE ROW LEVEL SECURITY;

-- Policy to allow service role full access
CREATE POLICY "Service role full access" ON lead_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);