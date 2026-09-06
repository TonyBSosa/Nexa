import { Router } from 'express';
import { knowledgeGapStatuses } from '@nexa/shared';
import type { KnowledgeGapStatus } from '@nexa/shared';
import type { KnowledgeRepository } from '../repositories/knowledge.js';

export function createKnowledgeRouter(repository: KnowledgeRepository) {
  const router = Router();
  router.get('/queries', (_request, response) => response.json({ items: repository.listQueries() }));
  router.get('/knowledge-gaps', (request, response) => {
    const status = request.query.status;
    if (status !== undefined && (typeof status !== 'string' || !knowledgeGapStatuses.includes(status as KnowledgeGapStatus))) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Estado de brecha no válido.' } });
      return;
    }
    response.json({ items: repository.listGaps(status as KnowledgeGapStatus | undefined) });
  });
  router.get('/knowledge-gaps/:id', (request, response) => {
    const gap = repository.getGap(request.params.id);
    if (!gap) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Brecha de conocimiento no encontrada.' } });
      return;
    }
    response.json(gap);
  });
  return router;
}
