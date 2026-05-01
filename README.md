# DaaS Lead Generation Pipeline

A distributed Data-as-a-Service lead generation pipeline with asynchronous processing workers, built for deployment on a 2GB RAM VPS.

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│   Next.js UI    │────▶│     Node.js Backend (VPS)            │
│  (Vercel/Local) │     │                                      │
│                 │◀────│  Express API Server                  │
│  • URL Input    │     │  ├── Ingest Route (/api/ingest)      │
│  • Status Track │     │  ├── Status Route (/api/status/:id)  │
│  • Results Grid │     │  └── Results Route (/api/results/:id)│
│  • CSV Export   │     │                                      │
└─────────────────┘     │  BullMQ Workers (async)              │
                        │  ├── Scraper Worker (Playwright, 2x) │
                        │  ├── LLM Worker (Claude API, 3x)     │
                        │  └── Enrichment Worker (Hunter.io,5x)│
                        └──────────┬───────────┬───────────────┘
                                   │           │
                        ┌──────────▼──┐  ┌─────▼──────────┐
                        │  Supabase   │  │  Upstash Redis  │
                        │ (PostgreSQL)│  │ (Message Queue) │
                        └─────────────┘  └────────────────┘
```

## Pipeline Flow

1. **Ingest** → User submits URLs → stored in Supabase → enqueued to Redis
2. **Scrape** → Playwright (headless Chromium) extracts page text, blocks non-essential assets, strips nav/footer, truncates to 3000 words
3. **Analyze** → Claude API analyzes text → returns company focus, data vulnerabilities, dataset recommendation, cold email hook
4. **Enrich** → Hunter.io API finds decision-maker contacts (Founders, CTOs, Lead Engineers)
5. **Complete** → Results available via API and displayed in dashboard

## Project Structure

```
├── backend/                    # Node.js backend (deployed to VPS)
│   ├── src/
│   │   ├── config/index.ts     # Environment configuration
│   │   ├── lib/
│   │   │   ├── supabase.ts     # Supabase client (lazy init)
│   │   │   └── queue.ts        # BullMQ queues (lazy init)
│   │   ├── middleware/auth.ts   # API key authentication
│   │   ├── routes/api.ts       # REST API routes
│   │   ├── workers/
│   │   │   ├── scraper.worker.ts   # Playwright scraping
│   │   │   ├── llm.worker.ts       # Claude API analysis
│   │   │   ├── enrichment.worker.ts # Hunter.io contacts
│   │   │   └── index.ts            # Worker orchestrator
│   │   └── server.ts           # Express server entry
│   ├── migrations/
│   │   └── 001_create_tables.sql   # Supabase schema
│   ├── dist/                   # Compiled JS (deployed)
│   └── package.json
│
├── frontend/                   # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx      # Root layout
│   │   │   ├── page.tsx        # Main page (all 3 components)
│   │   │   └── globals.css     # Tailwind styles
│   │   └── lib/
│   │       ├── api.ts          # Backend API client
│   │       └── csv.ts          # CSV export utility
│   └── package.json
│
└── README.md
```

## Setup Instructions

### 1. Cloud Services Setup

#### Supabase (PostgreSQL)
1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the migration:
   ```sql
   -- Copy contents of backend/migrations/001_create_tables.sql
   ```
3. Copy your **Project URL** and **Service Role Key** from Settings → API

#### Upstash Redis
1. Create a database at [upstash.com](https://upstash.com)
2. Copy the **Redis URL** (starts with `rediss://`)

#### API Keys
- **Anthropic**: Get key from [console.anthropic.com](https://console.anthropic.com)
- **Hunter.io**: Get key from [hunter.io](https://hunter.io)
- **Bright Data** (optional): Get proxy credentials from [brightdata.com](https://brightdata.com)

### 2. Backend Configuration (VPS)

Edit the environment file on the VPS:
```bash
nano /opt/daas-pipeline/.env
```

Fill in all values:
```env
PORT=3001
NODE_ENV=production
API_KEY=daas-pipeline-secure-key-2024

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your-service-key

REDIS_URL=rediss://default:your-password@your-host.upstash.io:6379

ANTHROPIC_API_KEY=sk-ant-...your-key
HUNTER_API_KEY=your-hunter-key

# Optional - leave empty to scrape without proxy
BRIGHTDATA_USERNAME=
BRIGHTDATA_PASSWORD=
```

Then restart the service:
```bash
systemctl restart daas-pipeline
journalctl -u daas-pipeline -f  # Watch logs
```

### 3. Frontend Configuration

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://144.172.99.105:3001
NEXT_PUBLIC_API_KEY=daas-pipeline-secure-key-2024
```

Run locally:
```bash
cd frontend
npm install
npm run dev
```

Or deploy to Vercel:
```bash
cd frontend
npx vercel --prod
# Set environment variables in Vercel dashboard
```

### 4. Database Migration

Run in Supabase SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS lead_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    scraped_text TEXT,
    llm_result JSONB,
    contacts JSONB DEFAULT '[]'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_jobs_batch_id ON lead_jobs(batch_id);
CREATE INDEX idx_lead_jobs_status ON lead_jobs(status);

ALTER TABLE lead_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_jobs
    FOR ALL USING (true) WITH CHECK (true);
```

## VPS Management

```bash
# Service management
systemctl status daas-pipeline    # Check status
systemctl restart daas-pipeline   # Restart
systemctl stop daas-pipeline      # Stop
journalctl -u daas-pipeline -f    # Live logs

# Health check
curl http://localhost:3001/api/health

# Test auth
curl -H "x-api-key: daas-pipeline-secure-key-2024" \
     http://localhost:3001/api/health
```

## Resource Constraints

- **Max 2 concurrent browser instances** (Playwright/Chromium)
- **Memory limit**: 1.5GB (systemd MemoryMax)
- **Aggressive asset blocking**: Images, fonts, media, tracking scripts all blocked
- **3000 word limit** on scraped text to optimize LLM token usage
- **BullMQ** ensures sequential processing to prevent OOM

## Security

- Pre-shared API key (`x-api-key` header) required for all endpoints except `/api/health`
- CORS restricted to localhost:3000, *.vercel.app, *.railway.app
- Supabase Row Level Security enabled
- Environment variables stored in `.env` (not committed to git)

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| POST | `/api/ingest` | Yes | Submit URLs for processing |
| GET | `/api/status/:batchId` | Yes | Get batch processing status |
| GET | `/api/results/:batchId` | Yes | Get completed results |

### POST /api/ingest
```json
{
  "urls": [
    "https://example.com",
    "https://another-company.com"
  ]
}
```

### Response
```json
{
  "batchId": "uuid",
  "totalJobs": 2,
  "jobs": [
    { "id": "uuid", "url": "https://example.com", "status": "pending" }
  ]
}