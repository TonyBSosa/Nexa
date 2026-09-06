import type {
  AddEvidenceRequest, ApprovalRequest, ApprovalResult, GenerateDraftRequest, GapTransitionRequest,
  KnowledgeDraft, KnowledgeGap, KnowledgeGapPriority, KnowledgeGapStatus, TriageUpdateRequest,
} from '@nexa/shared';
import { knowledgeGapStatuses } from '@nexa/shared';
import type { AgentProvider } from '../integrations/agent/AgentProvider.js';
import { assertDraftAllowed, DomainError } from '../domain/workflow.js';
import { validateDraft } from '../integrations/agent/validation.js';
import type { KnowledgeRepository } from '../repositories/knowledge.js';

function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.includes(key))) {
    throw new DomainError('INVALID_REQUEST', 'La solicitud no es válida.');
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_REQUEST', `${name} es obligatorio.`);
  return value.trim();
}

export class KnowledgeOperationsService {
  constructor(private readonly provider: AgentProvider, private readonly repository: KnowledgeRepository) {}

  triage(id: string, input: unknown): KnowledgeGap {
    const value = object(input, ['priority', 'category', 'suggestedDepartment', 'suggestedExperts']);
    if (!Object.keys(value).length) throw new DomainError('INVALID_REQUEST', 'Incluya al menos un campo de triage.');
    const update: TriageUpdateRequest = {};
    if ('priority' in value) {
      if (!['LOW', 'MEDIUM', 'HIGH'].includes(value.priority as string)) throw new DomainError('INVALID_REQUEST', 'Prioridad no válida.');
      update.priority = value.priority as KnowledgeGapPriority;
    }
    if ('category' in value) update.category = text(value.category, 'category');
    if ('suggestedDepartment' in value) {
      if (value.suggestedDepartment !== null && (typeof value.suggestedDepartment !== 'string' || !value.suggestedDepartment.trim())) {
        throw new DomainError('INVALID_REQUEST', 'suggestedDepartment debe ser texto o null.');
      }
      update.suggestedDepartment = typeof value.suggestedDepartment === 'string' ? value.suggestedDepartment.trim() : null;
    }
    if ('suggestedExperts' in value) {
      if (!Array.isArray(value.suggestedExperts) || value.suggestedExperts.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new DomainError('INVALID_REQUEST', 'suggestedExperts debe ser una lista de roles.');
      }
      update.suggestedExperts = value.suggestedExperts.map((item) => (item as string).trim());
    }
    return this.repository.triage(id, update);
  }

  transition(id: string, input: unknown) {
    const value = object(input, ['fromStatus', 'toStatus', 'selectedActionId', 'approveSimulatedAction', 'humanNote']);
    if (!knowledgeGapStatuses.includes(value.fromStatus as KnowledgeGapStatus)
      || !knowledgeGapStatuses.includes(value.toStatus as KnowledgeGapStatus)) {
      throw new DomainError('INVALID_REQUEST', 'Los estados de transición no son válidos.');
    }
    if ('selectedActionId' in value && typeof value.selectedActionId !== 'string') throw new DomainError('INVALID_REQUEST', 'selectedActionId no es válido.');
    if ('approveSimulatedAction' in value && value.approveSimulatedAction !== true) throw new DomainError('INVALID_REQUEST', 'La aprobación debe ser explícitamente true.');
    if ('humanNote' in value && typeof value.humanNote !== 'string') throw new DomainError('INVALID_REQUEST', 'humanNote no es válido.');
    const request: GapTransitionRequest = {
      fromStatus: value.fromStatus as KnowledgeGapStatus,
      toStatus: value.toStatus as KnowledgeGapStatus,
      ...(typeof value.selectedActionId === 'string' && { selectedActionId: value.selectedActionId }),
      ...(value.approveSimulatedAction === true && { approveSimulatedAction: true }),
      ...(typeof value.humanNote === 'string' && { humanNote: value.humanNote.trim() }),
    };
    return this.repository.transition(id, request);
  }

  addEvidence(id: string, input: unknown) {
    const value = object(input, ['content', 'origin', 'reference']);
    const request: AddEvidenceRequest = {
      content: text(value.content, 'content'), origin: text(value.origin, 'origin'),
      ...(value.reference !== undefined && { reference: text(value.reference, 'reference') }),
    };
    return this.repository.addEvidence(id, request);
  }

  async draft(id: string, input: unknown): Promise<KnowledgeDraft> {
    const value = object(input, ['mode', 'evidenceRevision', 'title', 'content']);
    if ((value.mode !== 'GENERATE' && value.mode !== 'SAVE')
      || !Number.isInteger(value.evidenceRevision) || (value.evidenceRevision as number) < 1) {
      throw new DomainError('INVALID_REQUEST', 'mode y evidenceRevision son obligatorios.');
    }
    const request: GenerateDraftRequest = value.mode === 'GENERATE'
      ? { mode: 'GENERATE', evidenceRevision: value.evidenceRevision as number }
      : { mode: 'SAVE', evidenceRevision: value.evidenceRevision as number, title: text(value.title, 'title'), content: text(value.content, 'content') };
    if (request.mode === 'SAVE') return this.repository.saveDraft(id, request.evidenceRevision, request.title, request.content);
    const gap = this.repository.getGap(id);
    if (!gap) throw new DomainError('NOT_FOUND', 'Brecha de conocimiento no encontrada.');
    assertDraftAllowed(gap.status, gap.evidenceRevision);
    if (gap.evidenceRevision !== request.evidenceRevision) throw new DomainError('STALE_STATE', 'La revisión de evidencia cambió.');
    let raw: unknown;
    try {
      raw = await this.provider.generateKnowledgeDraft({
        knowledgeGap: gap, evidence: gap.collectedInformation, evidenceRevision: request.evidenceRevision,
      });
    } catch {
      throw new DomainError('AGENT_UNAVAILABLE', 'No se pudo generar el borrador.');
    }
    const generated = validateDraft(raw);
    if (generated.status !== 'SUCCESS') {
      throw new DomainError('AGENT_UNAVAILABLE', 'No se pudo generar el borrador.');
    }
    return this.repository.saveDraft(id, request.evidenceRevision, generated.title.trim(), generated.content.trim());
  }

  approval(id: string, input: unknown): ApprovalResult {
    const value = object(input, ['decision', 'draftRevision', 'comment']);
    if (!['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(value.decision as string)
      || !Number.isInteger(value.draftRevision) || (value.draftRevision as number) < 1) {
      throw new DomainError('INVALID_REQUEST', 'decision y draftRevision son obligatorios.');
    }
    if ((value.decision === 'CHANGES_REQUESTED' || value.decision === 'REJECTED')
      && (typeof value.comment !== 'string' || !value.comment.trim())) {
      throw new DomainError('INVALID_REQUEST', 'El comentario es obligatorio para solicitar cambios o rechazar.');
    }
    if (value.comment !== undefined && typeof value.comment !== 'string') throw new DomainError('INVALID_REQUEST', 'comment no es válido.');
    const request: ApprovalRequest = {
      decision: value.decision as ApprovalRequest['decision'], draftRevision: value.draftRevision as number,
      ...(typeof value.comment === 'string' && { comment: value.comment.trim() }),
    };
    return this.repository.approve(id, request);
  }
}
