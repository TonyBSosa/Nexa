import type { KnowledgeDraft, KnowledgeGapStatus } from '@nexa/shared';

export type DomainErrorCode = 'NOT_FOUND' | 'INVALID_TRANSITION' | 'STALE_STATE' | 'APPROVAL_REQUIRED' | 'INVALID_REQUEST' | 'AGENT_UNAVAILABLE' | 'INVALID_PROVIDER_RESPONSE';

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) { super(message); }
}

export function requireStatus(actual: KnowledgeGapStatus, expected: KnowledgeGapStatus): void {
  if (actual !== expected) throw new DomainError('STALE_STATE', `La brecha está en ${actual}, no en ${expected}.`);
}

export function assertOperationTransition(from: KnowledgeGapStatus, to: KnowledgeGapStatus): void {
  const allowed = (from === 'DETECTED' && to === 'TRIAGED')
    || (from === 'TRIAGED' && to === 'ACTION_PROPOSED')
    || (from === 'ACTION_PROPOSED' && to === 'IN_PROGRESS')
    || (from === 'IN_PROGRESS' && to === 'KNOWLEDGE_COLLECTED')
    || (from === 'KNOWLEDGE_COLLECTED' && to === 'AWAITING_APPROVAL')
    || (from === 'PUBLISHED' && to === 'RESOLVED');
  if (!allowed) throw new DomainError('INVALID_TRANSITION', `No se permite avanzar de ${from} a ${to} mediante esta operación.`);
}

export function assertFreshDraft(draft: Pick<KnowledgeDraft, 'revision' | 'evidenceRevisionUsed'> | undefined, evidenceRevision: number, requestedRevision?: number): void {
  if (!draft || (requestedRevision !== undefined && draft.revision !== requestedRevision)) {
    throw new DomainError('STALE_STATE', 'Solo puede revisarse el borrador actual.');
  }
  if (draft.evidenceRevisionUsed !== evidenceRevision) {
    throw new DomainError('STALE_STATE', 'El borrador quedó obsoleto por nueva evidencia.');
  }
}

export function assertTriageAllowed(status: KnowledgeGapStatus): void {
  if (status !== 'DETECTED' && status !== 'TRIAGED') {
    throw new DomainError('INVALID_TRANSITION', 'La clasificación solo puede editarse durante detección o triage.');
  }
}

export function assertEvidenceAllowed(status: KnowledgeGapStatus): void {
  if (status !== 'IN_PROGRESS' && status !== 'KNOWLEDGE_COLLECTED') {
    throw new DomainError('INVALID_TRANSITION', 'La evidencia solo puede agregarse durante la recuperación activa.');
  }
}

export function assertDraftAllowed(status: KnowledgeGapStatus, evidenceRevision: number): void {
  if (status !== 'KNOWLEDGE_COLLECTED' || evidenceRevision === 0) {
    throw new DomainError('INVALID_TRANSITION', 'Recopile evidencia antes de generar un borrador.');
  }
}

export function assertApprovalAllowed(status: KnowledgeGapStatus): void {
  if (status !== 'AWAITING_APPROVAL') {
    throw new DomainError('INVALID_TRANSITION', 'Solo un borrador pendiente de revisión puede recibir una decisión.');
  }
}
