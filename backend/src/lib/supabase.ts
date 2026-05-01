import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

// Database types
export interface LeadJob {
  id: string;
  batch_id: string;
  url: string;
  status: 'pending' | 'scraping' | 'analyzing' | 'enriching' | 'completed' | 'failed';
  scraped_text: string | null;
  llm_result: LLMResult | null;
  contacts: HunterContact[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface LLMResult {
  company_name: string;
  core_focus: string;
  data_vulnerabilities: string[];
  recommended_dataset: string;
  cold_email_hook: string;
}

export interface HunterContact {
  email: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  department: string | null;
  linkedin: string | null;
}

// Initialize the leads table if it doesn't exist
export async function initDatabase(): Promise<void> {
  // Using Supabase SQL editor or migrations for table creation
  // This function verifies connectivity
  const { error } = await supabase.from('lead_jobs').select('id').limit(1);
  if (error && error.code === '42P01') {
    console.log('Table "lead_jobs" does not exist. Please create it via Supabase dashboard.');
    console.log('SQL migration provided in migrations/001_create_tables.sql');
  } else if (error) {
    console.error('Database connection error:', error.message);
  } else {
    console.log('Database connection verified.');
  }
}