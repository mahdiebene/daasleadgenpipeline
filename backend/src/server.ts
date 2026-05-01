import express from 'express';
import cors from 'cors';
import { config } from './config';
import { apiKeyAuth } from './middleware/auth';
import apiRoutes from './routes/api';
import { initDatabase } from './lib/supabase';

// Import and start workers in the same process (single VPS deployment)
import './workers/index';

const app = express();

// CORS configuration - allow frontend origins
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://*.vercel.app',
    'https://*.railway.app',
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

app.use(express.json({ limit: '1mb' }));

// Health check - no auth required
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// All other API routes require API key auth
app.use('/api', apiKeyAuth, apiRoutes);

// Start server
async function start() {
  try {
    await initDatabase();
    
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`[Server] Running on port ${config.port}`);
      console.log(`[Server] Environment: ${config.nodeEnv}`);
      console.log(`[Server] Health check: http://0.0.0.0:${config.port}/api/health`);
    });
  } catch (error: any) {
    console.error('[Server] Failed to start:', error.message);
    process.exit(1);
  }
}

start();