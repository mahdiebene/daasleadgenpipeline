'use client';

import { useState, useEffect, useCallback } from 'react';
import { ingestUrls, getBatchStatus, getBatchResults, StatusResponse, LeadResult } from '@/lib/api';
import { exportToCSV } from '@/lib/csv';

// ─── Status badge colors ───
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-600 text-gray-200',
  scraping: 'bg-yellow-600 text-yellow-100',
  analyzing: 'bg-blue-600 text-blue-100',
  enriching: 'bg-purple-600 text-purple-100',
  completed: 'bg-green-600 text-green-100',
  failed: 'bg-red-600 text-red-100',
};

// ═══════════════════════════════════════════════════════
// Component 1: Input Interface
// ═══════════════════════════════════════════════════════
function UrlInputPanel({
  onSubmit,
  isLoading,
}: {
  onSubmit: (urls: string[]) => void;
  isLoading: boolean;
}) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const urls = text
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);
    if (urls.length === 0) return;
    onSubmit(urls);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-3 text-white">Target URLs</h2>
      <p className="text-sm text-gray-400 mb-4">
        Enter one URL per line. Each URL will be scraped, analyzed by AI, and enriched with contact data.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`https://example.com\nhttps://another-company.io\nhttps://startup.dev`}
        className="w-full h-48 bg-gray-950 border border-gray-700 rounded-lg p-4 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        disabled={isLoading}
      />
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-gray-500">
          {text.split('\n').filter(u => u.trim()).length} URL(s) entered
        </span>
        <button
          onClick={handleSubmit}
          disabled={isLoading || text.trim().length === 0}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors duration-150 flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </>
          ) : (
            'Start Analysis'
          )}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Component 2: Live Status Tracker
// ═══════════════════════════════════════════════════════
function StatusTracker({ status }: { status: StatusResponse | null }) {
  if (!status) return null;

  const { summary, jobs } = status;
  const progressPercent = summary.total > 0
    ? Math.round(((summary.completed + summary.failed) / summary.total) * 100)
    : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Pipeline Status</h2>
        <span className="text-sm text-gray-400">
          {summary.completed + summary.failed}/{summary.total} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-3 mb-6">
        <div
          className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(summary).filter(([k]) => k !== 'total').map(([key, val]) => (
          <span
            key={key}
            className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[key] || 'bg-gray-700 text-gray-300'}`}
          >
            {key}: {val}
          </span>
        ))}
      </div>

      {/* Job list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {jobs.map(job => (
          <div
            key={job.id}
            className="flex items-center justify-between bg-gray-950 rounded-lg px-4 py-2.5 border border-gray-800"
          >
            <span className="text-sm text-gray-300 truncate max-w-md font-mono">
              {job.url}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[job.status] || 'bg-gray-700'}`}>
              {job.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Component 3: Results Dashboard
// ═══════════════════════════════════════════════════════
function ResultsDashboard({ results }: { results: LeadResult[] }) {
  if (results.length === 0) return null;

  const completedResults = results.filter(r => r.status === 'completed');

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Results Dashboard</h2>
        <button
          onClick={() => exportToCSV(results)}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Data grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Company</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Target Emails</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Weakness</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Dataset Pitch</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map(result => (
              <tr key={result.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3 px-4">
                  <div className="font-medium text-white">{result.company_name || '—'}</div>
                  <div className="text-xs text-gray-500 font-mono truncate max-w-48">{result.url}</div>
                </td>
                <td className="py-3 px-4">
                  {result.contacts && result.contacts.length > 0 ? (
                    <div className="space-y-1">
                      {result.contacts.slice(0, 3).map((c, i) => (
                        <div key={i} className="text-xs">
                          <span className="text-blue-400">{c.email}</span>
                          {c.position && (
                            <span className="text-gray-500 ml-1">({c.position})</span>
                          )}
                        </div>
                      ))}
                      {result.contacts.length > 3 && (
                        <div className="text-xs text-gray-500">+{result.contacts.length - 3} more</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-600">No contacts found</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {result.data_vulnerabilities ? (
                    <ul className="space-y-1">
                      {result.data_vulnerabilities.slice(0, 2).map((v, i) => (
                        <li key={i} className="text-xs text-orange-300">• {v}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="py-3 px-4 max-w-xs">
                  <p className="text-xs text-gray-300 line-clamp-3">
                    {result.recommended_dataset || '—'}
                  </p>
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[result.status] || 'bg-gray-700'}`}>
                    {result.status}
                  </span>
                  {result.error && (
                    <p className="text-xs text-red-400 mt-1 max-w-32 truncate" title={result.error}>
                      {result.error}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Email hook preview */}
      {completedResults.length > 0 && (
        <div className="mt-6 border-t border-gray-800 pt-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Cold Email Hooks Preview</h3>
          <div className="space-y-3">
            {completedResults.slice(0, 5).map(r => (
              <div key={r.id} className="bg-gray-950 rounded-lg p-4 border border-gray-800">
                <div className="text-xs text-blue-400 mb-1">{r.company_name}</div>
                <p className="text-sm text-gray-300 italic">&ldquo;{r.cold_email_hook}&rdquo;</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════
export default function Home() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (urls: string[]) => {
    setIsLoading(true);
    setError(null);
    setResults([]);
    setStatus(null);

    try {
      const response = await ingestUrls(urls);
      setBatchId(response.batchId);

      if (response.invalidUrls && response.invalidUrls.length > 0) {
        setError(`${response.invalidUrls.length} invalid URL(s) were skipped`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit URLs');
      setIsLoading(false);
    }
  };

  // Poll for status updates
  const pollStatus = useCallback(async () => {
    if (!batchId) return;

    try {
      const statusData = await getBatchStatus(batchId);
      setStatus(statusData);

      // Check if all jobs are done
      const allDone = statusData.summary.completed + statusData.summary.failed === statusData.summary.total;

      if (allDone && statusData.summary.total > 0) {
        // Fetch full results
        const resultsData = await getBatchResults(batchId);
        setResults(resultsData.results);
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error('Polling error:', err);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;

    // Initial poll
    pollStatus();

    // Set up polling interval (every 3 seconds)
    const interval = setInterval(pollStatus, 3000);

    return () => clearInterval(interval);
  }, [batchId, pollStatus]);

  return (
    <div className="space-y-8">
      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Component 1: Input Interface */}
      <UrlInputPanel onSubmit={handleSubmit} isLoading={isLoading} />

      {/* Component 2: Live Status Tracker */}
      <StatusTracker status={status} />

      {/* Component 3: Results Dashboard */}
      <ResultsDashboard results={results} />
    </div>
  );
}