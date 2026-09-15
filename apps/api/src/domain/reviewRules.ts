import type { ApprovalDecision } from '@nexa/shared';
import { invalidRequest, optionalText, requireObject, requirePositiveInteger, requireText } from './inputValidation.js';
import { splitLines } from './revisionDiff.js';
import { DomainError } from './workflow.js';

const maxActorLength = 120;
const maxReviewers = 10;
const maxCommentLength = 2_000;
const decisions: readonly ApprovalDecision[] = ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'];

export interface ReviewDecision {
  actor: string;
  decision: ApprovalDecision;
  draftRevision: number;
  comment: string | null;
}

export interface ReviewDecisionContext {
  revisionUnderReview: number | null;
  submittedBy: string;
  draftAuthors: string[];
  assignedReviewers: string[];
  revisionAlreadyDecided: boolean;
}

export interface ContentCommentContext {
  revisionUnderReview: number | null;
  draftContent: string;
}

export interface ContentComment {
  actor: string;
  draftRevision: number;
  startLine: number | null;
  endLine: number | null;
  quote: string | null;
  body: string;
}

export function normalizeActor(value: unknown, name = 'actor'): string {
  return requireText(value, name, maxActorLength).replace(/\s+/g, ' ');
}

export function sameActor(left: string, right: string): boolean {
  const key = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('es');
  return key(left) === key(right);
}

function isAuthor(actor: string, submittedBy: string, draftAuthors: string[]): boolean {
  return sameActor(actor, submittedBy) || draftAuthors.some((author) => sameActor(actor, author));
}

export function assertRevisionUnderReview(revisionUnderReview: number | null, requestedRevision: number): void {
  if (revisionUnderReview === null) {
    throw new DomainError('INVALID_TRANSITION', 'No hay una revisión de borrador en revisión.');
  }
  if (revisionUnderReview !== requestedRevision) {
    throw new DomainError('STALE_STATE', `La revisión ${revisionUnderReview} está bloqueada en revisión; no la ${requestedRevision}.`);
  }
}

export function validateReviewerAssignment(submittedBy: string, draftAuthors: string[], reviewers: unknown): string[] {
  if (!Array.isArray(reviewers) || !reviewers.length) return invalidRequest('Asigne al menos un revisor.');
  if (reviewers.length > maxReviewers) return invalidRequest(`Se admiten como máximo ${maxReviewers} revisores.`);
  const normalized: string[] = [];
  for (const reviewer of reviewers) {
    const name = normalizeActor(reviewer, 'reviewer');
    if (isAuthor(name, submittedBy, draftAuthors)) return invalidRequest('El autor del contenido no puede ser revisor.');
    if (normalized.some((existing) => sameActor(existing, name))) return invalidRequest('Hay revisores duplicados.');
    normalized.push(name);
  }
  return normalized;
}

export function validateReviewDecision(context: ReviewDecisionContext, input: unknown): ReviewDecision {
  const value = requireObject(input, ['actor', 'decision', 'draftRevision', 'comment']);
  const actor = normalizeActor(value.actor);
  if (!decisions.includes(value.decision as ApprovalDecision)) return invalidRequest('decision no es válida.');
  const decision = value.decision as ApprovalDecision;
  const draftRevision = requirePositiveInteger(value.draftRevision, 'draftRevision');
  const comment = decision === 'APPROVED'
    ? optionalText(value.comment, 'comment', maxCommentLength)
    : requireText(value.comment, 'El comentario para solicitar cambios o rechazar', maxCommentLength);
  assertRevisionUnderReview(context.revisionUnderReview, draftRevision);
  if (context.revisionAlreadyDecided) {
    throw new DomainError('STALE_STATE', 'Esta revisión de borrador ya fue decidida.');
  }
  if (isAuthor(actor, context.submittedBy, context.draftAuthors)) {
    throw new DomainError('APPROVAL_REQUIRED', 'El autor del contenido no puede decidir sobre su propia revisión.');
  }
  if (!context.assignedReviewers.some((reviewer) => sameActor(reviewer, actor))) {
    throw new DomainError('APPROVAL_REQUIRED', 'Solo un revisor asignado puede registrar la decisión.');
  }
  return { actor, decision, draftRevision, comment };
}

export function validateContentComment(context: ContentCommentContext, input: unknown): ContentComment {
  const value = requireObject(input, ['actor', 'draftRevision', 'startLine', 'endLine', 'quote', 'body']);
  const actor = normalizeActor(value.actor);
  const draftRevision = requirePositiveInteger(value.draftRevision, 'draftRevision');
  const body = requireText(value.body, 'body', maxCommentLength);
  const quote = optionalText(value.quote, 'quote', maxCommentLength);
  const hasStart = value.startLine !== undefined && value.startLine !== null;
  const hasEnd = value.endLine !== undefined && value.endLine !== null;
  if (hasStart !== hasEnd) return invalidRequest('startLine y endLine deben indicarse juntos.');
  if (quote !== null && !hasStart) return invalidRequest('La cita requiere un rango de líneas.');
  assertRevisionUnderReview(context.revisionUnderReview, draftRevision);
  if (!hasStart) return { actor, draftRevision, startLine: null, endLine: null, quote: null, body };

  const startLine = requirePositiveInteger(value.startLine, 'startLine');
  const endLine = requirePositiveInteger(value.endLine, 'endLine');
  const lines = splitLines(context.draftContent);
  if (startLine > endLine || endLine > lines.length) {
    return invalidRequest(`El rango de líneas debe estar entre 1 y ${lines.length}.`);
  }
  if (quote !== null && !lines.slice(startLine - 1, endLine).join('\n').includes(quote)) {
    throw new DomainError('STALE_STATE', 'La cita no coincide con el contenido de la revisión.');
  }
  return { actor, draftRevision, startLine, endLine, quote, body };
}
