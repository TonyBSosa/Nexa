import { Router } from 'express';
import { knowledgeGapStatuses } from '@nexa/shared';
import type { ReviewDecision, ReviewDecisionRequest, ReviewFilters, ReviewMetadata } from '@nexa/shared';
import type { KnowledgeRepository } from '../repositories/knowledge.js';
import { DomainError } from '../domain/workflow.js';

function invalid(message = 'La solicitud de revisión no es válida.'): never { throw new DomainError('INVALID_REQUEST', message); }
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) invalid();
  return input as Record<string, unknown>;
}
function text(value: unknown, required = false): string {
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) invalid('Complete los campos obligatorios con texto válido.');
  return value.trim();
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid('Falta la revisión actual.');
  return value as number;
}
function date(value: unknown): string {
  const result = text(value, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid('Fecha no válida.');
  return result;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) invalid();
  return value.map(item => text(item, true));
}

export function createReviewRouter(repository: KnowledgeRepository) {
  const router = Router();
  router.get('/knowledge-reviews', (request, response) => {
    const query = object(request.query, ['q', 'disposition', 'priority', 'department', 'status', 'from', 'to', 'page', 'pageSize']);
    const filters: ReviewFilters = { page: 1, pageSize: 10 };
    for (const key of ['page', 'pageSize'] as const) if (key in query) {
      if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key])) invalid('Página no válida.');
      const value = Number(query[key]);
      if (!Number.isSafeInteger(value) || value > (key === 'pageSize' ? 100 : 1_000_000)) invalid('Página fuera de rango.');
      filters[key] = value;
    }
    if ('q' in query) filters.q = text(query.q);
    if ('department' in query) filters.department = text(query.department);
    if ('disposition' in query) {
      if (!['PENDING', 'ACCEPTED', 'DISCARDED', 'DUPLICATE'].includes(query.disposition as string)) invalid();
      filters.disposition = query.disposition as NonNullable<ReviewFilters['disposition']>;
    }
    if ('priority' in query) {
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(query.priority as string)) invalid();
      filters.priority = query.priority as NonNullable<ReviewFilters['priority']>;
    }
    if ('status' in query) {
      if (!knowledgeGapStatuses.includes(query.status as typeof knowledgeGapStatuses[number])) invalid();
      filters.status = query.status as NonNullable<ReviewFilters['status']>;
    }
    if ('from' in query) filters.from = date(query.from);
    if ('to' in query) filters.to = date(query.to);
    if (filters.from && filters.to && filters.from > filters.to) invalid('El rango de fechas está invertido.');
    response.json(repository.listReviews(filters));
  });
  router.get('/knowledge-gaps/:id/review', (request, response) => response.json(repository.getReview(request.params.id)));
  router.patch('/knowledge-gaps/:id/review', (request, response) => {
    const value = object(request.body, ['revision', 'title', 'category', 'priority', 'department', 'responsible', 'experts', 'sensitivity', 'targetDate', 'importance', 'relatedGapIds', 'relatedArticleIds']);
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(value.priority as string) || !['NORMAL', 'INTERNAL', 'SENSITIVE'].includes(value.sensitivity as string)) invalid();
    const metadata: ReviewMetadata = { revision: revision(value.revision), title: text(value.title, true), category: text(value.category),
      priority: value.priority as ReviewMetadata['priority'], department: text(value.department), responsible: text(value.responsible),
      experts: strings(value.experts), sensitivity: value.sensitivity as ReviewMetadata['sensitivity'], targetDate: value.targetDate === null ? null : date(value.targetDate),
      importance: text(value.importance), relatedGapIds: strings(value.relatedGapIds), relatedArticleIds: strings(value.relatedArticleIds) };
    response.json(repository.saveReview(request.params.id, metadata));
  });
  router.post('/knowledge-gaps/:id/review/decision', (request, response) => {
    const value = object(request.body, ['revision', 'decision', 'actor', 'reason', 'duplicateOf']);
    if (!['ACCEPT', 'DISCARD_NOT_APPLICABLE', 'DISCARD_SENSITIVE', 'DISCARD_IMPROPER', 'DUPLICATE', 'RESTORE', 'RETURN'].includes(value.decision as string)) invalid();
    const input: ReviewDecisionRequest = { revision: revision(value.revision), decision: value.decision as ReviewDecision, actor: text(value.actor, true),
      ...(value.reason !== undefined && { reason: text(value.reason) }), ...(value.duplicateOf !== undefined && { duplicateOf: text(value.duplicateOf, true) }) };
    response.json(repository.decideReview(request.params.id, input));
  });
  router.post('/knowledge-gaps/:id/review/classify', (request, response) => {
    const value = object(request.body, ['revision', 'actor']);
    response.json(repository.confirmReview(request.params.id, revision(value.revision), text(value.actor, true)));
  });
  return router;
}
