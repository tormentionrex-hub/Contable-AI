import { Router } from 'express';
import { dbHealth } from '../lib/db.js';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const db = dbHealth();
  res.json({
    status: db === 'connected' ? 'ok' : 'degraded',
    version: config.version,
    db,
  });
});
