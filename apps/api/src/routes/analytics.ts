import { Router } from 'express';
import type { KnowledgeRepository } from '../repositories/knowledge.js';
import { getAnalytics } from '../services/analytics.js';

export function createAnalyticsRouter(repository: KnowledgeRepository) {
  const router = Router();
  router.get(['/dashboard', '/analytics'], (_request, response) => response.json(getAnalytics(repository)));
  return router;
}
