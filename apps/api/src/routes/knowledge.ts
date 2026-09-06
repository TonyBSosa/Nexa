import { Router } from 'express';
import { knowledgeGapStatuses } from '@nexa/shared';
import type { KnowledgeGapStatus } from '@nexa/shared';
import type { KnowledgeRepository } from '../repositories/knowledge.js';
import type { KnowledgeOperationsService } from '../services/knowledgeOperations.js';

export function createKnowledgeRouter(repository: KnowledgeRepository, operations: KnowledgeOperationsService) {
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
  router.patch('/knowledge-gaps/:id/triage', (request, response, next) => {
    try { response.json(operations.triage(request.params.id, request.body)); } catch (error) { next(error); }
  });
  router.post('/knowledge-gaps/:id/transition', (request, response, next) => {
    try { response.json(operations.transition(request.params.id, request.body)); } catch (error) { next(error); }
  });
  router.post('/knowledge-gaps/:id/evidence', (request, response, next) => {
    try { response.status(201).json(operations.addEvidence(request.params.id, request.body)); } catch (error) { next(error); }
  });
  router.post('/knowledge-gaps/:id/draft', async (request, response, next) => {
    try { response.status(201).json(await operations.draft(request.params.id, request.body)); } catch (error) { next(error); }
  });
  router.post('/knowledge-gaps/:id/approval', (request, response, next) => {
    try { response.json(operations.approval(request.params.id, request.body)); } catch (error) { next(error); }
  });
  router.get('/knowledge', (_request, response) => response.json({ items: repository.listApprovedKnowledge() }));
  return router;
}
