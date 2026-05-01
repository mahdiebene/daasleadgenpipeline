'use client';

import { useState, useEffect, useCallback } from 'react';
import { ingestSearch, getBatchStatus, getBatchResults, StatusResponse, LeadResult } from '@/lib/api';
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
// Component 1: Niche & Location Input
// ═══════════════════════════════════════════════════════
function SearchInputPanel({
  onSubmit,
  isLoading,
}: {
  onSubmit: (niche: string, location: string) => void;
  isLoading: boolean;
}) {
  const [niche, setNiche] = useState('');
  const [location, setLocation] = useState('');

  const handleSubmit = () => {
    if (!niche.trim() || !location.trim()) return;
    onSubmit(niche.trim(), location.trim());
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-3 text-white">Lead Search</h2>
      <p className="text-sm text-gray-400 mb-4">
        Enter a business niche and location. We&apos;ll find businesses, scrape their websites, and generate AI-powered lead intelligence.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Target Niche</label>
          <input
            type="text"
            value={niche}
            onChange={e => setNiche(e.target.value)}
            placeholder="e.g. Plumbers, Dentists, SaaS Companies"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Target Location</label>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="e.g. New York, NY or Los Angeles, CA"
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
      </div>
      <div className="flex items-center justify-end">
        <button
          onClick={handleSubmit}
          disabled={isLoading || !niche.trim() || !location.trim()}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors duration-150 flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Searching...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Find Leads
            </>
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
            <div className="flex-1 min-w-0 mr-3">
              <span className="text-sm text-white font-medium block truncate">
                {job.business_name || job.url || '—'}
              </span>
              {job.phone && (
                <span className="text-xs text-gray-500">{job.phone}</span>
              )}
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_COLORS[job.status] || 'bg-gray-700'}`}>
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
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Business</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Phone</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Contacts</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Weakness</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Dataset Pitch</th>
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map(result => (
              <tr key={result.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3 px-4">
                  <div className="font-medium text-white">{result.business_name || result.company_name || '—'}</div>
                  {result.address && (
                    <div className="text-xs text-gray-500 mt-0.5">{result.address}</div>
                  )}
                  {result.url && (
                    <div className="text-xs text-blue-500 font-mono truncate max-w-48">{result.url}</div>
                  )}
                </td>
                <td className="py-3 px-4">
                  {result.phone ? (
                    <span className="text-sm text-gray-300">{result.phone}</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
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
                    <span className="text-gray-600">—</span>
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
      {completedResults.filter(r => r.cold_email_hook).length > 0 && (
        <div className="mt-6 border-t border-gray-800 pt-6">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Cold Email Hooks Preview</h3>
          <div className="space-y-3">
            {completedResults.filter(r => r.cold_email_hook).slice(0, 5).map(r => (
              <div key={r.id} className="bg-gray-950 rounded-lg p-4 border border-gray-800">
                <div className="text-xs text-blue-400 mb-1">{r.business_name || r.company_name}</div>
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
  const [searchInfo, setSearchInfo] = useState<string | null>(null);

  const handleSubmit = async (niche: string, location: string) => {
    setIsLoading(true);
    setError(null);
    setResults([]);
    setStatus(null);
    setSearchInfo(null);

    try {
      const response = await ingestSearch(niche, location);
      setBatchId(response.batchId);
      setSearchInfo(`Found ${response.totalBusinesses} businesses (${response.totalWithWebsites} with websites)`);
    } catch (err: any) {
      setError(err.message || 'Failed to search directory');
      setIsLoading(false);
    }
  };

  // Poll for status updates
  const pollStatus = useCallback(async () => {
    if (!batchId) return;

    try {
      const statusData = await getBatchStatus(batchId);
      setStatus(statusData);

      const allDone = statusData.summary.completed + statusData.summary.failed === statusData.summary.total;

      if (allDone && statusData.summary.total > 0) {
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

    pollStatus();
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

      {/* Search info banner */}
      {searchInfo && (
        <div className="bg-blue-900/30 border border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-300">
          {searchInfo}
        </div>
      )}

      {/* Component 1: Search Input */}
      <SearchInputPanel onSubmit={handleSubmit} isLoading={isLoading} />

      {/* Component 2: Live Status Tracker */}
      <StatusTracker status={status} />

      {/* Component 3: Results Dashboard */}
      <ResultsDashboard results={results} />
    </div>
  );
}