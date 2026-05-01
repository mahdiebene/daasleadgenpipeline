import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!config.apiKey) {
    console.warn('[Auth] WARNING: No API_KEY configured. All requests will be rejected.');
    res.status(500).json({ error: 'Server misconfigured: API key not set' });
    return;
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key. Include x-api-key header.' });
    return;
  }

  if (apiKey !== config.apiKey) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}