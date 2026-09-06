import type { DraftGenerationResult, EvidenceReference, QuestionAssessment } from '@nexa/shared';
import { DomainError } from '../../domain/workflow.js';
import { isObject, nonempty, recoveryProposals } from '../../domain/recoveryActions.js';

function invalid(): never {
  throw new DomainError('INVALID_PROVIDER_RESPONSE', 'El agente devolvió una respuesta no válida.');
}

function evidence(value: unknown): value is EvidenceReference {
  if (!isObject(value) || !nonempty(value.sourceId) || !nonempty(value.title)) return false;
  if (value.documentId !== undefined && !nonempty(value.documentId)) return false;
  if (value.locator !== undefined && !nonempty(value.locator)) return false;
  if (value.sourceId === 'nexa-approved' || value.articleId !== undefined || value.articleRevision !== undefined) {
    if (!nonempty(value.articleId) || !Number.isSafeInteger(value.articleRevision) || Number(value.articleRevision) < 1) return false;
  }
  return true;
}

export function validateAssessment(value: unknown): QuestionAssessment {
  if (!isObject(value) || !Array.isArray(value.evidence) || !value.evidence.every(evidence)) return invalid();
  const sources = value.evidence.map(({ sourceId, title, documentId, locator, articleId, articleRevision }) => ({
    sourceId, title, ...(documentId !== undefined && { documentId }), ...(locator !== undefined && { locator }),
    ...(articleId !== undefined && { articleId }), ...(articleRevision !== undefined && { articleRevision }),
  }));
  if (value.status === 'FAILURE') {
    if (value.organizationallyRelevant !== null || value.retrievalCompleted !== false || value.answer !== null) return invalid();
    return { status: 'FAILURE', organizationallyRelevant: null, retrievalCompleted: false, answer: null, evidence: [] };
  }
  if (value.status === 'SUFFICIENT') {
    if (value.organizationallyRelevant !== true || value.retrievalCompleted !== true || !nonempty(value.answer) || !sources.length) return invalid();
    return { status: 'SUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true, answer: value.answer.trim(), evidence: sources };
  }
  if (value.status !== 'INSUFFICIENT' || typeof value.organizationallyRelevant !== 'boolean'
    || typeof value.retrievalCompleted !== 'boolean' || value.answer !== null) return invalid();
  for (const key of ['suggestedCategory', 'suggestedDepartment']) {
    if (value[key] !== undefined && value[key] !== null && !nonempty(value[key])) return invalid();
  }
  if (value.suggestedExperts !== undefined && (!Array.isArray(value.suggestedExperts) || !value.suggestedExperts.every(nonempty))) return invalid();
  if (value.suggestedActions !== undefined && !Array.isArray(value.suggestedActions)) return invalid();
  return {
    status: 'INSUFFICIENT', organizationallyRelevant: value.organizationallyRelevant,
    retrievalCompleted: value.retrievalCompleted, answer: null, evidence: sources,
    ...(nonempty(value.suggestedCategory) && { suggestedCategory: value.suggestedCategory.trim() }),
    ...(nonempty(value.suggestedDepartment) && { suggestedDepartment: value.suggestedDepartment.trim() }),
    ...(Array.isArray(value.suggestedExperts) && { suggestedExperts: value.suggestedExperts.filter(nonempty).map((item) => item.trim()) }),
    suggestedActions: recoveryProposals(value.suggestedActions),
  };
}

export function validateDraft(value: unknown): DraftGenerationResult {
  if (!isObject(value)) return invalid();
  if (value.status === 'FAILURE') return { status: 'FAILURE' };
  if (value.status !== 'SUCCESS' || !nonempty(value.title) || !nonempty(value.content)) return invalid();
  return { status: 'SUCCESS', title: value.title.trim(), content: value.content.trim() };
}
