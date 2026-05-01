import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // API Security
  apiKey: process.env.API_KEY || '',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',

  // Redis (Upstash)
  redisUrl: process.env.REDIS_URL || '',

  // Bright Data Proxy
  brightData: {
    host: process.env.BRIGHTDATA_HOST || 'brd.superproxy.io',
    port: parseInt(process.env.BRIGHTDATA_PORT || '22225', 10),
    username: process.env.BRIGHTDATA_USERNAME || '',
    password: process.env.BRIGHTDATA_PASSWORD || '',
  },

  // Anthropic Claude API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // Google Maps Places API
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  // Scraper constraints
  scraper: {
    maxConcurrency: 2,
    maxWordCount: 3000,
    navigationTimeout: 30000,
  },
};