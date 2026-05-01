const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

export interface IngestResponse {
  batchId: string;
  totalJobs: number;
  invalidUrls?: string[];
  jobs: { id: string; url: string; status: string }[];
}

export interface StatusResponse {
  batchId: string;
  summary: {
    total: number;
    pending: number;
    scraping: number;
    analyzing: number;
    enriching: number;
    completed: number;
    failed: number;
  };
  jobs: {
    id: string;
    url: string;
    status: string;
    error: string | null;
    created_at: string;
    updated_at: string;
  }[];
}

export interface LeadResult {
  id: string;
  url: string;
  status: string;
  company_name: string | null;
  core_focus: string | null;
  data_vulnerabilities: string[] | null;
  recommended_dataset: string | null;
  cold_email_hook: string | null;
  contacts: {
    email: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
  }[];
  error: string | null;
}

export interface ResultsResponse {
  batchId: string;
  results: LeadResult[];
}

export async function ingestUrls(urls: string[]): Promise<IngestResponse> {
  return apiRequest('/api/ingest', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

export async function getBatchStatus(batchId: string): Promise<StatusResponse> {
  return apiRequest(`/api/status/${batchId}`);
}

export async function getBatchResults(batchId: string): Promise<ResultsResponse> {
  return apiRequest(`/api/results/${batchId}`);
}