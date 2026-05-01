import { LeadResult } from './api';

export function exportToCSV(results: LeadResult[], filename: string = 'leads.csv'): void {
  const headers = [
    'Company Name',
    'URL',
    'Status',
    'Core Focus',
    'Data Vulnerabilities',
    'Recommended Dataset',
    'Cold Email Hook',
    'Contact Emails',
    'Contact Names',
    'Contact Positions',
    'Error',
  ];

  const rows = results.map(r => [
    escapeCsvField(r.company_name || ''),
    escapeCsvField(r.url),
    escapeCsvField(r.status),
    escapeCsvField(r.core_focus || ''),
    escapeCsvField((r.data_vulnerabilities || []).join('; ')),
    escapeCsvField(r.recommended_dataset || ''),
    escapeCsvField(r.cold_email_hook || ''),
    escapeCsvField((r.contacts || []).map(c => c.email).join('; ')),
    escapeCsvField((r.contacts || []).map(c => [c.first_name, c.last_name].filter(Boolean).join(' ')).join('; ')),
    escapeCsvField((r.contacts || []).map(c => c.position || '').join('; ')),
    escapeCsvField(r.error || ''),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}