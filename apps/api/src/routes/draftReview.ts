import { Router } from 'express';
import type { ChecklistConfirmations } from '@nexa/shared';
import type { KnowledgeRepository } from '../repositories/knowledge.js';
import { invalidRequest, requireObject, requireText } from '../domain/inputValidation.js';

const maxActorLength = 120;

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidRequest(`${name} debe ser un entero no negativo.`);
  }
  return value;
}

function confirmations(input: unknown): ChecklistConfirmations {
  const value = requireObject(input, ['answerClear', 'noImproperConfidentialInfo', 'readyForReview']);
  const flag = (key: keyof ChecklistConfirmations): boolean => {
    if (typeof value[key] !== 'boolean') return invalidRequest(`${key} debe ser verdadero o falso.`);
    return value[key];
  };
  return {
    answerClear: flag('answerClear'),
    noImproperConfidentialInfo: flag('noImproperConfidentialInfo'),
    readyForReview: flag('readyForReview'),
  };
}

/**
 * The /review paths belong to the human review of the request during triage.
 * Draft review lives under /draft-review to keep both stages apart.
 */
export function createDraftReviewRouter(repository: KnowledgeRepository) {
  const router = Router();

  router.get('/knowledge-gaps/:id/draft-review', (request, response, next) => {
    try {
      response.json(repository.getDraftReview(request.params.id));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/evidence-items', (request, response, next) => {
    try {
      response.status(201).json(repository.addEvidenceItem(request.params.id, request.body));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/evidence/:evidenceId/withdraw', (request, response, next) => {
    try {
      response.json(repository.withdrawEvidence(request.params.id, request.params.evidenceId, request.body));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/evidence/:evidenceId/replace', (request, response, next) => {
    try {
      response.json(repository.replaceEvidence(request.params.id, request.params.evidenceId, request.body));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/draft-review/checklist', (request, response, next) => {
    try {
      const value = requireObject(request.body, ['revision', 'confirmations']);
      response.json(repository.confirmChecklist(request.params.id, {
        revision: nonNegativeInteger(value.revision, 'revision'),
        confirmations: confirmations(value.confirmations),
      }));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/draft-review/reviewers', (request, response, next) => {
    try {
      const value = requireObject(request.body, ['revision', 'submittedBy', 'reviewers']);
      if (!Array.isArray(value.reviewers)) invalidRequest('reviewers debe ser una lista.');
      response.json(repository.assignReviewers(request.params.id, {
        revision: nonNegativeInteger(value.revision, 'revision'),
        submittedBy: requireText(value.submittedBy, 'submittedBy', maxActorLength),
        reviewers: value.reviewers as string[],
      }));
    } catch (error) { next(error); }
  });

  router.post('/knowledge-gaps/:id/draft-review/comments', (request, response, next) => {
    try {
      response.status(201).json(repository.addDraftComment(request.params.id, request.body));
    } catch (error) { next(error); }
  });

  return router;
}
