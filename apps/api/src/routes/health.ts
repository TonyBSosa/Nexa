import { Router } from 'express';
import type { HealthResponse } from '@nexa/shared';

export const healthRouter = Router();

healthRouter.get('/health', (_request, response) => {
  const health: HealthResponse = { status: 'ok', service: 'nexa-api' };
  response.json(health);
});
