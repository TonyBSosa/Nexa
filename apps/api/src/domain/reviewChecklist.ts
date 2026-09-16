import type { ChecklistConfirmations, ReviewChecklistItem, ReviewChecklistKey, ReviewChecklistResult } from '@nexa/shared';
import { reviewChecklistKeys } from '@nexa/shared';
import { DomainError } from './workflow.js';

export { reviewChecklistKeys };
export type {
  ChecklistConfirmations, ReviewChecklistKey, ReviewChecklistItem, ReviewChecklistResult,
} from '@nexa/shared';

export interface ChecklistEvidence {
  id: string;
  source: string | null;
  withdrawn: boolean;
}

export interface ChecklistDraft {
  title: string;
  content: string;
  citedEvidenceIds: string[];
}

export interface ReviewChecklistInput {
  evidence: ChecklistEvidence[];
  draft: ChecklistDraft | null;
  confirmations: ChecklistConfirmations;
}

const labels: Record<ReviewChecklistKey, string> = {
  HAS_EVIDENCE: 'Hay evidencia',
  SOURCES_IDENTIFIED: 'La fuente está identificada',
  ANSWER_CLEAR: 'La respuesta es clara',
  NO_IMPROPER_CONFIDENTIAL_INFO: 'No contiene información confidencial improcedente',
  READY_FOR_REVIEW: 'Está lista para revisión',
};

function filled(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function item(key: ReviewChecklistKey, kind: ReviewChecklistItem['kind'], reason: string | null): ReviewChecklistItem {
  return { key, label: labels[key], kind, satisfied: reason === null, reason };
}

function sourcesReason(active: ChecklistEvidence[], draft: ChecklistDraft | null): string | null {
  if (!active.length) return 'No hay evidencia vigente con fuente.';
  if (active.some((evidence) => !filled(evidence.source))) return 'Hay evidencia vigente sin fuente identificada.';
  if (!draft) return 'El borrador no existe todavía.';
  if (!draft.citedEvidenceIds.length) return 'El borrador no cita ninguna evidencia.';
  const activeIds = new Set(active.map((evidence) => evidence.id));
  if (draft.citedEvidenceIds.some((id) => !activeIds.has(id))) return 'El borrador cita evidencia retirada o inexistente.';
  return null;
}

export function evaluateReviewChecklist({ evidence, draft, confirmations }: ReviewChecklistInput): ReviewChecklistResult {
  const active = evidence.filter((entry) => !entry.withdrawn);
  const hasEvidence = item('HAS_EVIDENCE', 'AUTOMATIC', active.length ? null : 'No hay evidencia vigente.');
  const sources = item('SOURCES_IDENTIFIED', 'AUTOMATIC', sourcesReason(active, draft));
  const clear = item('ANSWER_CLEAR', 'CONFIRMATION', !draft || !filled(draft.title) || !filled(draft.content)
    ? 'El borrador necesita título y contenido.'
    : confirmations.answerClear ? null : 'Falta confirmar que la respuesta es clara.');
  const confidential = item('NO_IMPROPER_CONFIDENTIAL_INFO', 'CONFIRMATION', confirmations.noImproperConfidentialInfo
    ? null : 'Falta confirmar que no hay información confidencial improcedente.');
  const previous = [hasEvidence, sources, clear, confidential];
  const ready = item('READY_FOR_REVIEW', 'CONFIRMATION', previous.some((entry) => !entry.satisfied)
    ? 'Complete los demás puntos de la lista.'
    : confirmations.readyForReview ? null : 'Falta confirmar que está lista para revisión.');
  const items = [...previous, ready];
  return { items, complete: items.every((entry) => entry.satisfied) };
}

export function assertReviewChecklistComplete(result: ReviewChecklistResult): void {
  const pending = result.items.filter((entry) => !entry.satisfied);
  if (pending.length) {
    throw new DomainError('INVALID_TRANSITION', `Lista de verificación incompleta: ${pending.map((entry) => entry.label).join('; ')}.`);
  }
}
