import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ReviewDetail, ReviewMetadata, ReviewDecisionRequest, ReviewFilters, ReviewList } from '@nexa/shared';
import type {
  AddDraftCommentRequest, AddEvidenceItemRequest, AssignReviewersRequest, ConfirmChecklistRequest,
  DraftReviewDetail, ReplaceEvidenceRequest, WithdrawEvidenceRequest,
} from '@nexa/shared';
import { ReviewStore } from './review.js';
import { DraftReviewStore } from './draftReview.js';
import { EvidenceFileStore } from '../persistence/fileStore.js';
import type {
  ActivityEvent, ActivityEventType, AddActivityRequest, AddEvidenceRequest, Approval, ApprovalRequest,
  ApprovalResult, ApprovedKnowledgeArticle, ChatResponse, CollectedEvidence, CreateManualActionRequest,
  GapTransitionRequest, KnowledgeDraft, KnowledgeGap, KnowledgeGapDetail, KnowledgeGapStatus, Query,
  RecoveryAction, TriageUpdateRequest, UpdateRecoveryActionRequest,
} from '@nexa/shared';
import { questionKey } from '../domain/questionKey.js';
import { approvedResponse } from '../domain/approvedKnowledge.js';
import { contactsForGap, missingInformationHint } from '../domain/contacts.js';
import {
  actionReadyForApproval, createRecoveryAction, enrichActionDefaults, isUsableAction, nonempty,
  normalizeStoredAction, recoveryProposals,
} from '../domain/recoveryActions.js';
import {
  assertApprovalAllowed, assertDraftAllowed, assertEvidenceAllowed, assertOperationTransition,
  assertFreshDraft, assertTriageAllowed, DomainError, requireStatus,
} from '../domain/workflow.js';
import { assertReviewChecklistComplete } from '../domain/reviewChecklist.js';
import { validateDraftReviewDecision } from '../domain/reviewRules.js';

/** Uploads sit beside the database, under the repository-root data directory. */
const defaultUploadsRoot = fileURLToPath(new URL('../../../../data/uploads', import.meta.url));

export class PersistenceError extends Error {
  constructor() { super('No se pudo guardar o leer la información.'); }
}

export interface KnowledgeRepository {
  getReview(id: string): ReviewDetail;
  listReviews(filters: ReviewFilters): ReviewList;
  saveReview(id: string, metadata: ReviewMetadata): ReviewDetail;
  decideReview(id: string, request: ReviewDecisionRequest): ReviewDetail;
  confirmReview(id: string, revision: number, actor: string): ReviewDetail;
  getDraftReview(id: string): DraftReviewDetail;
  addEvidenceItem(id: string, request: AddEvidenceItemRequest): DraftReviewDetail;
  withdrawEvidence(id: string, evidenceId: string, request: WithdrawEvidenceRequest): DraftReviewDetail;
  replaceEvidence(id: string, evidenceId: string, request: ReplaceEvidenceRequest): DraftReviewDetail;
  confirmChecklist(id: string, request: ConfirmChecklistRequest): DraftReviewDetail;
  assignReviewers(id: string, request: AssignReviewersRequest): DraftReviewDetail;
  addDraftComment(id: string, request: AddDraftCommentRequest): DraftReviewDetail;
  readEvidenceFile(id: string, evidenceId: string): { bytes: Buffer; fileName: string; mimeType: string };
  record(message: string, response: ChatResponse, gapEligible: boolean, clientSessionId?: string): Query;
  listQueries(): Query[];
  listGaps(status?: KnowledgeGapStatus): KnowledgeGap[];
  getGap(id: string): KnowledgeGapDetail | undefined;
  triage(id: string, update: TriageUpdateRequest): KnowledgeGap;
  transition(id: string, request: GapTransitionRequest): { id: string; status: KnowledgeGapStatus; updatedAt: string };
  addEvidence(id: string, request: AddEvidenceRequest): CollectedEvidence;
  saveDraft(id: string, evidenceRevision: number, title: string, content: string): KnowledgeDraft;
  approve(id: string, request: ApprovalRequest): ApprovalResult;
  findApprovedKnowledge(normalizedQuestionKey: string): ApprovedKnowledgeArticle | undefined;
  listApprovedKnowledge(): ApprovedKnowledgeArticle[];
  updateAction(id: string, request: UpdateRecoveryActionRequest): KnowledgeGapDetail;
  createManualAction(id: string, request: CreateManualActionRequest): KnowledgeGapDetail;
  discardAction(id: string, actionId: string): KnowledgeGapDetail;
  addActivity(id: string, request: AddActivityRequest): ActivityEvent;
}

type GapRow = Omit<KnowledgeGap, 'suggestedExperts' | 'suggestedActions' | 'selectedAction'> & {
  suggestedExperts: string; suggestedActions: string; selectedAction: string | null;
};
type QueryRow = Omit<Query, 'organizationallyRelevant' | 'sufficientKnowledge' | 'countedAsKnowledgeGapOccurrence' | 'evidence'> & {
  organizationallyRelevant: number | null; sufficientKnowledge: number;
  countedAsKnowledgeGapOccurrence: number; evidence: string;
};
type DraftRow = Omit<KnowledgeDraft, 'publication'>;

function actionFromUnknown(value: unknown, gap: GapRow, index: number): RecoveryAction {
  try {
    return normalizeStoredAction(value, gap.id, index, gap.createdAt);
  } catch {
    throw new PersistenceError();
  }
}

function gapFromRow(row: GapRow): KnowledgeGap {
  const raw: unknown = JSON.parse(row.suggestedActions);
  const experts: unknown = JSON.parse(row.suggestedExperts);
  if (!Array.isArray(raw) || !Array.isArray(experts) || !experts.every(nonempty)) throw new PersistenceError();
  const selectedAction = row.selectedAction ? actionFromUnknown(JSON.parse(row.selectedAction), row, 0) : null;
  const actions = raw.map((item, index) => actionFromUnknown(item, row, index))
    .map((action) => selectedAction?.id === action.id ? selectedAction : action);
  return {
    ...row,
    suggestedExperts: experts,
    suggestedActions: actions,
    selectedAction,
  };
}

export class SQLiteKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly files: EvidenceFileStore = new EvidenceFileStore(defaultUploadsRoot),
  ) {}

  private get reviews() { return new ReviewStore(this.db, this.now); }
  private get draftReviews() { return new DraftReviewStore(this.db, this.now, this.files); }
  getDraftReview(id: string): DraftReviewDetail { return this.guard(() => this.draftReviews.detail(id)); }
  addEvidenceItem(id: string, request: AddEvidenceItemRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.addEvidence(id, request)); }
  withdrawEvidence(id: string, evidenceId: string, request: WithdrawEvidenceRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.withdrawEvidence(id, evidenceId, request)); }
  replaceEvidence(id: string, evidenceId: string, request: ReplaceEvidenceRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.replaceEvidence(id, evidenceId, request)); }
  confirmChecklist(id: string, request: ConfirmChecklistRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.confirmChecklist(id, request.revision, request.confirmations)); }
  assignReviewers(id: string, request: AssignReviewersRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.assignReviewers(id, request.revision, request.submittedBy, request.reviewers)); }
  addDraftComment(id: string, request: AddDraftCommentRequest): DraftReviewDetail { return this.guard(() => this.draftReviews.addComment(id, request)); }
  readEvidenceFile(id: string, evidenceId: string) { return this.guard(() => this.draftReviews.readFile(id, evidenceId)); }
  getReview(id: string): ReviewDetail { return this.guard(() => this.reviews.detail(id)); }
  saveReview(id: string, metadata: ReviewMetadata): ReviewDetail { return this.guard(() => this.reviews.save(id, metadata)); }
  decideReview(id: string, request: ReviewDecisionRequest): ReviewDetail { return this.guard(() => this.reviews.decide(id, request)); }
  confirmReview(id: string, revision: number, actor: string): ReviewDetail { return this.guard(() => this.reviews.confirm(id, revision, actor)); }
  listReviews(filters: ReviewFilters): ReviewList {
    return this.guard(() => this.db.transaction(() => {
      const result = this.reviews.list(filters);
      return { items: result.ids.map(id => ({ ...gapFromRow(this.gapRow(id)), reviewDisposition: this.reviews.state(id).disposition })),
        total: result.total, page: filters.page, pageSize: filters.pageSize };
    })());
  }

  private guard<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new PersistenceError();
    }
  }

  private gapRow(id: string): GapRow {
    const row = this.db.prepare<[string], GapRow>('SELECT * FROM knowledge_gaps WHERE id = ?').get(id);
    if (!row) throw new DomainError('NOT_FOUND', 'Brecha de conocimiento no encontrada.');
    return row;
  }

  private insertActivity(knowledgeGapId: string, type: ActivityEventType, summary: string, detail: string | null, createdAt: string): ActivityEvent {
    const event: ActivityEvent = { id: randomUUID(), knowledgeGapId, type, summary, detail, createdAt };
    this.db.prepare(`INSERT INTO recovery_activity (id, knowledgeGapId, type, summary, detail, createdAt)
      VALUES (@id, @knowledgeGapId, @type, @summary, @detail, @createdAt)`).run(event);
    return event;
  }

  private detailFromId(id: string): KnowledgeGapDetail {
    const detail = this.getGap(id);
    if (!detail) throw new DomainError('NOT_FOUND', 'Brecha de conocimiento no encontrada.');
    return detail;
  }

  private actionContext(gap: KnowledgeGap) {
    return {
      question: gap.originalQuestion,
      contacts: contactsForGap(gap.suggestedDepartment, gap.suggestedExperts),
      department: gap.suggestedDepartment,
    };
  }

  private persistActions(id: string, actions: RecoveryAction[], selected: RecoveryAction | null, status: KnowledgeGapStatus | null, now: string): void {
    if (status) {
      this.db.prepare('UPDATE knowledge_gaps SET status = ?, selectedAction = ?, suggestedActions = ?, updatedAt = ? WHERE id = ?')
        .run(status, selected ? JSON.stringify(selected) : null, JSON.stringify(actions), now, id);
      return;
    }
    this.db.prepare('UPDATE knowledge_gaps SET selectedAction = ?, suggestedActions = ?, updatedAt = ? WHERE id = ?')
      .run(selected ? JSON.stringify(selected) : null, JSON.stringify(actions), now, id);
  }

  record(message: string, response: ChatResponse, gapEligible: boolean, clientSessionId?: string): Query {
    return this.guard(() => this.db.transaction(() => {
      const approved = this.findApprovedKnowledge(questionKey(message));
      if (approved) response = approvedResponse(response.queryId, approved);
      const now = this.now();
      const createdAt = now.toISOString();
      const key = response.organizationallyRelevant === true ? questionKey(message) : null;
      let gapId: string | null = null;
      let countedAsKnowledgeGapOccurrence = false;
      if (gapEligible && response.status === 'INSUFFICIENT' && response.organizationallyRelevant === true && key) {
        const existing = this.db.prepare<[string], { id: string }>("SELECT id FROM knowledge_gaps WHERE normalizedQuestionKey = ? AND status <> 'RESOLVED'").get(key);
        gapId = existing?.id ?? randomUUID();
        if (existing) {
          const duplicateInWindow = clientSessionId !== undefined && this.db.prepare<[string, string, string], { found: number }>(`
            SELECT 1 AS found FROM queries WHERE clientSessionId = ? AND knowledgeGapId = ?
              AND countedAsKnowledgeGapOccurrence = 1 AND createdAt > ? LIMIT 1
          `).get(clientSessionId, gapId, new Date(now.getTime() - 5 * 60_000).toISOString()) !== undefined;
          if (!duplicateInWindow) {
            this.db.prepare('UPDATE knowledge_gaps SET occurrences = occurrences + 1, updatedAt = ? WHERE id = ?').run(createdAt, gapId);
            countedAsKnowledgeGapOccurrence = true;
          }
        } else {
          countedAsKnowledgeGapOccurrence = true;
          const department = response.suggestedDepartment ?? null;
          const experts = response.suggestedExperts ?? [];
          const context = {
            question: message,
            contacts: contactsForGap(department, experts),
            department,
          };
          const actions: RecoveryAction[] = recoveryProposals(response.suggestedActions).map((action) => (
            createRecoveryAction(action, randomUUID(), createdAt, context, {}, true)
          ));
          this.db.prepare(`INSERT INTO knowledge_gaps
            (id, originalQuestion, normalizedQuestionKey, title, category, status, priority, occurrences, evidenceRevision, suggestedDepartment, suggestedExperts, suggestedActions, selectedAction, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, 'DETECTED', 'MEDIUM', 1, 0, ?, ?, ?, NULL, ?, ?)`)
            .run(gapId, message, key, message, response.suggestedCategory ?? null,
              department, JSON.stringify(experts),
              JSON.stringify(actions), createdAt, createdAt);
        }
      }
      const query: Query = {
        id: response.queryId, message, clientSessionId: clientSessionId ?? null, normalizedQuestionKey: key,
        assessmentStatus: response.status, organizationallyRelevant: response.organizationallyRelevant,
        sufficientKnowledge: response.sufficientKnowledge, answer: response.answer,
        category: response.suggestedCategory ?? null, evidence: response.evidence,
        knowledgeGapId: gapId, countedAsKnowledgeGapOccurrence, createdAt,
      };
      this.db.prepare(`INSERT INTO queries
        (id, message, clientSessionId, normalizedQuestionKey, assessmentStatus, organizationallyRelevant, sufficientKnowledge, answer, category, evidence, knowledgeGapId, countedAsKnowledgeGapOccurrence, createdAt)
        VALUES (@id, @message, @clientSessionId, @normalizedQuestionKey, @assessmentStatus, @organizationallyRelevant, @sufficientKnowledge, @answer, @category, @evidence, @knowledgeGapId, @countedAsKnowledgeGapOccurrence, @createdAt)`)
        .run({ ...query,
          organizationallyRelevant: query.organizationallyRelevant === null ? null : Number(query.organizationallyRelevant),
          sufficientKnowledge: Number(query.sufficientKnowledge), countedAsKnowledgeGapOccurrence: Number(query.countedAsKnowledgeGapOccurrence),
          evidence: JSON.stringify(query.evidence),
        });
      return query;
    }).immediate());
  }

  listQueries(): Query[] {
    return this.guard(() => this.db.prepare<[], QueryRow>('SELECT * FROM queries ORDER BY createdAt DESC, rowid DESC').all().map((row) => ({
      ...row, organizationallyRelevant: row.organizationallyRelevant === null ? null : Boolean(row.organizationallyRelevant),
      sufficientKnowledge: Boolean(row.sufficientKnowledge), countedAsKnowledgeGapOccurrence: Boolean(row.countedAsKnowledgeGapOccurrence),
      evidence: JSON.parse(row.evidence),
    })));
  }

  listGaps(status?: KnowledgeGapStatus): KnowledgeGap[] {
    return this.guard(() => (status
      ? this.db.prepare<[string], GapRow>('SELECT * FROM knowledge_gaps WHERE status = ? ORDER BY updatedAt DESC, rowid DESC').all(status)
      : this.db.prepare<[], GapRow>('SELECT * FROM knowledge_gaps ORDER BY updatedAt DESC, rowid DESC').all()).map(gapFromRow));
  }

  getGap(id: string): KnowledgeGapDetail | undefined {
    return this.guard(() => {
      const row = this.db.prepare<[string], GapRow>('SELECT * FROM knowledge_gaps WHERE id = ?').get(id);
      if (!row) return undefined;
      const gap = gapFromRow(row);
      const collectedInformation = this.db.prepare<[string], CollectedEvidence>('SELECT * FROM collected_evidence WHERE knowledgeGapId = ? ORDER BY revision').all(id);
      const article = this.db.prepare<[string], ApprovedKnowledgeArticle>('SELECT * FROM approved_knowledge WHERE sourceKnowledgeGapId = ?').get(id) ?? null;
      const drafts = this.db.prepare<[string], DraftRow>('SELECT * FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision').all(id).map((draft) => ({
        ...draft,
        publication: article?.approvedDraftRevision === draft.revision
          ? { articleId: article.articleId, articleRevision: article.revision, sourceId: 'nexa-approved' as const } : null,
      }));
      const activity = this.db.prepare<[string], ActivityEvent>(
        'SELECT * FROM recovery_activity WHERE knowledgeGapId = ? ORDER BY createdAt DESC, rowid DESC',
      ).all(id);
      return {
        ...gap, collectedInformation, drafts, currentDraft: drafts.at(-1) ?? null,
        approvals: this.db.prepare<[string], Approval>('SELECT id, knowledgeGapId, decision, draftRevision, comment, createdAt FROM approvals WHERE knowledgeGapId = ? ORDER BY createdAt, rowid').all(id),
        publishedArticle: article,
        contacts: contactsForGap(gap.suggestedDepartment, gap.suggestedExperts),
        activity,
        missingInformation: missingInformationHint(gap.originalQuestion, gap.evidenceRevision),
      };
    });
  }

  triage(id: string, update: TriageUpdateRequest): KnowledgeGap {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      assertTriageAllowed(row.status);
      this.reviews.invalidateClassification(id);
      const now = this.now().toISOString();
      this.db.prepare(`UPDATE knowledge_gaps SET priority = ?, category = ?,
        suggestedDepartment = ?, suggestedExperts = ?, updatedAt = ? WHERE id = ?`).run(
        update.priority ?? row.priority,
        update.category ?? row.category,
        Object.hasOwn(update, 'suggestedDepartment') ? update.suggestedDepartment ?? null : row.suggestedDepartment,
        Object.hasOwn(update, 'suggestedExperts') ? JSON.stringify(update.suggestedExperts) : row.suggestedExperts,
        now, id,
      );
      return gapFromRow(this.gapRow(id));
    }).immediate());
  }

  transition(id: string, request: GapTransitionRequest): { id: string; status: KnowledgeGapStatus; updatedAt: string } {
    return this.guard(() => this.db.transaction((): { id: string; status: KnowledgeGapStatus; updatedAt: string } => {
      const row = this.gapRow(id);
      requireStatus(row.status, request.fromStatus);
      assertOperationTransition(request.fromStatus, request.toStatus);
      this.reviews.guardTransition(id, request.toStatus);
      const now = this.now().toISOString();
      let selectedAction = row.selectedAction;
      const gap = gapFromRow(row);
      const context = this.actionContext(gap);

      if (request.fromStatus === 'IN_PROGRESS' && request.toStatus === 'ACTION_PROPOSED') {
        if (!nonempty(request.humanNote)) {
          throw new DomainError('INVALID_REQUEST', 'Indique por qué debe cambiarse la estrategia de recuperación.');
        }
        const current = gap.selectedAction;
        const reset = current ? {
          ...current,
          approvedAt: null,
          executionStatus: 'PENDING' as const,
          cancelReason: null,
          humanNote: request.humanNote.trim(),
          updatedAt: now,
        } : null;
        const actions = gap.suggestedActions.map((action) => (reset && action.id === reset.id ? reset : action));
        this.persistActions(id, actions, reset, 'ACTION_PROPOSED', now);
        this.insertActivity(id, 'STRATEGY_CHANGE', 'Se regresó a Acción propuesta para cambiar la estrategia.', request.humanNote.trim(), now);
        return { id, status: 'ACTION_PROPOSED', updatedAt: now };
      }

      if (request.toStatus === 'ACTION_PROPOSED') {
        if (!gap.suggestedActions.some((action) => isUsableAction(action) && !action.discarded)) {
          throw new DomainError('INVALID_TRANSITION', 'Se requiere una propuesta utilizable.');
        }
        if (request.selectedActionId) {
          const action = gap.suggestedActions.find((candidate) => candidate.id === request.selectedActionId && !candidate.discarded);
          if (!action) throw new DomainError('INVALID_REQUEST', 'La acción seleccionada no pertenece a esta brecha.');
          const enriched = {
            ...enrichActionDefaults(action, context, now),
            id: action.id,
            humanNote: request.humanNote?.trim() || action.humanNote,
            updatedAt: now,
            approvedAt: action.approvedAt,
            discarded: false,
          } as RecoveryAction;
          selectedAction = JSON.stringify(enriched);
          this.insertActivity(id, 'ACTION_SELECTED', `Se seleccionó la acción: ${enriched.description}`, null, now);
        }
      }
      if (request.toStatus === 'IN_PROGRESS') {
        if (request.approveSimulatedAction !== true || !request.selectedActionId) {
          throw new DomainError('APPROVAL_REQUIRED', 'Se requiere aprobación humana explícita de la acción simulada.');
        }
        const action = gap.suggestedActions.find((candidate) => candidate.id === request.selectedActionId && !candidate.discarded);
        if (!action) throw new DomainError('INVALID_REQUEST', 'La acción seleccionada no pertenece a esta brecha.');
        const enriched = {
          ...enrichActionDefaults(action, context, now),
          id: action.id,
          humanNote: request.humanNote?.trim() || action.humanNote,
          approvedAt: now,
          updatedAt: now,
          discarded: false,
          executionStatus: action.executionStatus === 'CANCELLED' ? 'PENDING' : action.executionStatus,
        } as RecoveryAction;
        if (!actionReadyForApproval(enriched)) {
          throw new DomainError('INVALID_REQUEST', 'La acción debe tener responsable, destinatario, objetivo y fecha límite antes de confirmarse.');
        }
        selectedAction = JSON.stringify(enriched);
        this.insertActivity(id, 'ACTION_APPROVED', 'Una persona confirmó la acción simulada. No se ejecutó ningún envío externo.', enriched.humanNote, now);
      }
      if (request.toStatus === 'KNOWLEDGE_COLLECTED' && row.evidenceRevision < 1) {
        throw new DomainError('INVALID_TRANSITION', 'Recopile evidencia antes de avanzar.');
      }
      if (request.toStatus === 'AWAITING_APPROVAL') {
        const draft = this.latestDraft(id);
        assertFreshDraft(draft, row.evidenceRevision);
        const reviewed = this.db.prepare<[string], { revision: number }>('SELECT COALESCE(MAX(draftRevision), 0) AS revision FROM approvals WHERE knowledgeGapId = ?').get(id)!;
        if (draft!.revision <= reviewed.revision) throw new DomainError('STALE_STATE', 'Genere una revisión nueva antes de enviarla.');
        // The checklist only gates gaps whose draft review has been started, so
        // flows that never open the panel keep their previous behaviour.
        if (this.draftReviews.state(id).revision > 0) {
          assertReviewChecklistComplete(this.draftReviews.checklist(id));
        }
      }
      if (request.toStatus === 'RESOLVED') this.assertPublication(row);
      const selected = selectedAction ? actionFromUnknown(JSON.parse(selectedAction), row, 0) : null;
      const actions = gap.suggestedActions.map((action) => selected?.id === action.id ? selected : action);
      this.persistActions(id, actions, selected, request.toStatus, now);
      return { id, status: request.toStatus, updatedAt: now };
    }).immediate());
  }

  updateAction(id: string, request: UpdateRecoveryActionRequest): KnowledgeGapDetail {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      const gap = gapFromRow(row);
      if (gap.status !== 'TRIAGED' && gap.status !== 'ACTION_PROPOSED' && gap.status !== 'IN_PROGRESS') {
        throw new DomainError('INVALID_TRANSITION', 'La acción solo puede editarse en clasificación, acción propuesta o en progreso.');
      }
      const index = gap.suggestedActions.findIndex((action) => action.id === request.actionId);
      if (index < 0) throw new DomainError('NOT_FOUND', 'Acción de recuperación no encontrada.');
      const current = gap.suggestedActions[index]!;
      if (current.discarded) throw new DomainError('INVALID_REQUEST', 'No se puede editar una sugerencia descartada.');
      const now = this.now().toISOString();
      const next: RecoveryAction = {
        ...current,
        description: request.description !== undefined ? request.description.trim() : current.description,
        recipient: Object.hasOwn(request, 'recipient') ? request.recipient ?? null : current.recipient,
        subject: Object.hasOwn(request, 'subject') ? request.subject ?? null : current.subject,
        objective: Object.hasOwn(request, 'objective') ? request.objective ?? null : current.objective,
        dueAt: Object.hasOwn(request, 'dueAt') ? request.dueAt ?? null : current.dueAt,
        notes: Object.hasOwn(request, 'notes') ? request.notes ?? null : current.notes,
        agenda: Object.hasOwn(request, 'agenda') ? request.agenda ?? null : current.agenda,
        meetingLink: Object.hasOwn(request, 'meetingLink') ? request.meetingLink ?? null : current.meetingLink,
        meetingAt: Object.hasOwn(request, 'meetingAt') ? request.meetingAt ?? null : current.meetingAt,
        participants: request.participants ?? current.participants,
        externalTaskReference: Object.hasOwn(request, 'externalTaskReference')
          ? request.externalTaskReference ?? null : current.externalTaskReference,
        responsible: Object.hasOwn(request, 'responsible') ? request.responsible ?? null : current.responsible,
        executionStatus: request.executionStatus ?? current.executionStatus,
        sentAt: Object.hasOwn(request, 'sentAt') ? request.sentAt ?? null : current.sentAt,
        respondedAt: Object.hasOwn(request, 'respondedAt') ? request.respondedAt ?? null : current.respondedAt,
        responseAttachment: Object.hasOwn(request, 'responseAttachment')
          ? request.responseAttachment ?? null : current.responseAttachment,
        cancelReason: Object.hasOwn(request, 'cancelReason') ? request.cancelReason ?? null : current.cancelReason,
        preparedEmailBody: Object.hasOwn(request, 'preparedEmailBody')
          ? request.preparedEmailBody ?? null : current.preparedEmailBody,
        reminderNote: Object.hasOwn(request, 'reminderNote') ? request.reminderNote ?? null : current.reminderNote,
        humanNote: Object.hasOwn(request, 'humanNote') ? request.humanNote ?? null : current.humanNote,
        updatedAt: now,
      };
      if (next.executionStatus === 'CANCELLED' && !nonempty(next.cancelReason)) {
        throw new DomainError('INVALID_REQUEST', 'La cancelación requiere una justificación.');
      }
      if (next.description.trim() === '') throw new DomainError('INVALID_REQUEST', 'description es obligatorio.');
      const actions = [...gap.suggestedActions];
      actions[index] = next;
      const selectedNext = gap.selectedAction?.id === next.id ? next : gap.selectedAction;
      this.persistActions(id, actions, selectedNext, null, now);

      const notes: string[] = [];
      if (request.executionStatus && request.executionStatus !== current.executionStatus) {
        this.insertActivity(id, request.executionStatus === 'CANCELLED' ? 'CANCEL' : 'STATUS_CHANGE',
          `Estado de la acción: ${request.executionStatus}.`, next.cancelReason, now);
        notes.push('status');
      }
      if (Object.hasOwn(request, 'responsible') && request.responsible !== current.responsible) {
        this.insertActivity(id, 'RESPONSIBLE_CHANGE', `Responsable actualizado: ${next.responsible ?? 'sin asignar'}.`, null, now);
        notes.push('responsible');
      }
      if (Object.hasOwn(request, 'dueAt') && request.dueAt !== current.dueAt) {
        this.insertActivity(id, 'DEADLINE_CHANGE', `Fecha límite reajustada: ${next.dueAt ?? 'sin fecha'}.`, null, now);
        notes.push('dueAt');
      }
      if (Object.hasOwn(request, 'meetingLink') || Object.hasOwn(request, 'meetingAt') || Object.hasOwn(request, 'participants') || Object.hasOwn(request, 'agenda')) {
        this.insertActivity(id, 'MEETING_UPDATE', 'Se actualizaron datos de la reunión simulada.', null, now);
        notes.push('meeting');
      }
      if (Object.hasOwn(request, 'sentAt') || Object.hasOwn(request, 'respondedAt') || Object.hasOwn(request, 'responseAttachment') || Object.hasOwn(request, 'reminderNote')) {
        this.insertActivity(id, 'REQUEST_UPDATE', 'Se actualizó el seguimiento de la solicitud.', next.reminderNote, now);
        notes.push('request');
      }
      if (!notes.length) this.insertActivity(id, 'ACTION_UPDATED', 'Se editó la acción propuesta.', null, now);
      return this.detailFromId(id);
    }).immediate());
  }

  createManualAction(id: string, request: CreateManualActionRequest): KnowledgeGapDetail {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      const gap = gapFromRow(row);
      if (gap.status !== 'TRIAGED' && gap.status !== 'ACTION_PROPOSED') {
        throw new DomainError('INVALID_TRANSITION', 'Las acciones manuales solo pueden crearse en clasificación o acción propuesta.');
      }
      const now = this.now().toISOString();
      const action = createRecoveryAction(
        { type: request.type, description: request.description },
        randomUUID(),
        now,
        this.actionContext(gap),
        {
          recipient: request.recipient ?? null,
          subject: request.subject ?? null,
          objective: request.objective ?? null,
          dueAt: request.dueAt ?? null,
          notes: request.notes ?? null,
          agenda: request.agenda ?? null,
          responsible: request.responsible ?? null,
        },
      );
      const actions = [...gap.suggestedActions, action];
      const selected = gap.status === 'ACTION_PROPOSED' ? action : gap.selectedAction;
      this.persistActions(id, actions, selected, null, now);
      this.insertActivity(id, 'ACTION_CREATED', `Se creó una acción manual: ${action.description}`, null, now);
      return this.detailFromId(id);
    }).immediate());
  }

  discardAction(id: string, actionId: string): KnowledgeGapDetail {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      const gap = gapFromRow(row);
      if (gap.status !== 'TRIAGED' && gap.status !== 'ACTION_PROPOSED') {
        throw new DomainError('INVALID_TRANSITION', 'Solo pueden descartarse sugerencias antes de iniciar la recuperación.');
      }
      const index = gap.suggestedActions.findIndex((action) => action.id === actionId);
      if (index < 0) throw new DomainError('NOT_FOUND', 'Acción de recuperación no encontrada.');
      const current = gap.suggestedActions[index]!;
      if (current.discarded) return this.detailFromId(id);
      const active = gap.suggestedActions.filter((action) => !action.discarded && action.id !== actionId);
      if (!active.length) throw new DomainError('INVALID_REQUEST', 'Debe quedar al menos una acción utilizable.');
      const now = this.now().toISOString();
      const discarded = { ...current, discarded: true, updatedAt: now };
      const actions = gap.suggestedActions.map((action) => (action.id === actionId ? discarded : action));
      const selected = gap.selectedAction?.id === actionId ? active[0]! : gap.selectedAction;
      this.persistActions(id, actions, selected, null, now);
      this.insertActivity(id, 'ACTION_DISCARDED', `Se descartó la sugerencia: ${current.description}`, null, now);
      return this.detailFromId(id);
    }).immediate());
  }

  addActivity(id: string, request: AddActivityRequest): ActivityEvent {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      if (row.status !== 'IN_PROGRESS' && row.status !== 'ACTION_PROPOSED' && row.status !== 'KNOWLEDGE_COLLECTED') {
        throw new DomainError('INVALID_TRANSITION', 'Los avances solo pueden registrarse durante la recuperación.');
      }
      const now = this.now().toISOString();
      this.db.prepare('UPDATE knowledge_gaps SET updatedAt = ? WHERE id = ?').run(now, id);
      return this.insertActivity(id, request.type ?? 'NOTE', request.summary, request.detail ?? null, now);
    }).immediate());
  }

  addEvidence(id: string, request: AddEvidenceRequest): CollectedEvidence {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      assertEvidenceAllowed(row.status);
      const revision = row.evidenceRevision + 1;
      const evidence: CollectedEvidence = {
        id: randomUUID(), knowledgeGapId: id, content: request.content, sourceType: 'MANUAL',
        sourceLabel: request.origin, reference: request.reference ?? null,
        revision, createdAt: this.now().toISOString(),
      };
      this.db.prepare(`INSERT INTO collected_evidence
        (id, knowledgeGapId, content, sourceType, sourceLabel, reference, revision, createdAt)
        VALUES (@id, @knowledgeGapId, @content, @sourceType, @sourceLabel, @reference, @revision, @createdAt)`).run(evidence);
      this.db.prepare('UPDATE knowledge_gaps SET evidenceRevision = ?, updatedAt = ? WHERE id = ?')
        .run(revision, evidence.createdAt, id);
      this.insertActivity(id, 'NOTE', `Se registró evidencia (revisión ${revision}).`, request.origin, evidence.createdAt);
      return evidence;
    }).immediate());
  }

  saveDraft(id: string, evidenceRevision: number, title: string, content: string): KnowledgeDraft {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      assertDraftAllowed(row.status, row.evidenceRevision);
      if (row.evidenceRevision !== evidenceRevision) throw new DomainError('STALE_STATE', 'La evidencia cambió; genere el borrador con la revisión actual.');
      const latest = this.db.prepare<[string], { revision: number }>('SELECT revision FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision DESC LIMIT 1').get(id);
      const now = this.now().toISOString();
      const draft: KnowledgeDraft = {
        id: randomUUID(), knowledgeGapId: id, revision: (latest?.revision ?? 0) + 1,
        evidenceRevisionUsed: evidenceRevision, title, content, publication: null,
        createdAt: now, updatedAt: now,
      };
      this.db.prepare(`INSERT INTO knowledge_drafts
        (id, knowledgeGapId, revision, evidenceRevisionUsed, title, content, createdAt, updatedAt)
        VALUES (@id, @knowledgeGapId, @revision, @evidenceRevisionUsed, @title, @content, @createdAt, @updatedAt)`).run(draft);
      this.db.prepare('UPDATE knowledge_gaps SET updatedAt = ? WHERE id = ?').run(now, id);
      return draft;
    }).immediate());
  }

  approve(id: string, request: ApprovalRequest): ApprovalResult {
    return this.guard(() => this.db.transaction((): ApprovalResult => {
      const row = this.gapRow(id);
      const prior = this.db.prepare<[string, number], Approval>('SELECT id, knowledgeGapId, decision, draftRevision, comment, createdAt FROM approvals WHERE knowledgeGapId = ? AND draftRevision = ?').get(id, request.draftRevision);
      if (prior?.decision === 'APPROVED' && (row.status === 'PUBLISHED' || row.status === 'RESOLVED')) {
        if (request.decision !== 'APPROVED') throw new DomainError('INVALID_TRANSITION', 'No se puede cambiar una aprobación publicada.');
        const priorArticle = this.assertPublication(row, request.draftRevision);
        return { approval: prior, gapStatus: row.status, publication: { articleId: priorArticle.articleId, articleRevision: priorArticle.revision, sourceId: 'nexa-approved' } };
      }
      const draft = this.latestDraft(id);
      assertFreshDraft(draft, row.evidenceRevision, request.draftRevision);
      assertApprovalAllowed(row.status);
      if (prior) throw new DomainError('STALE_STATE', 'Esta revisión de borrador ya fue decidida; genere una revisión nueva.');
      const now = this.now().toISOString();
      // Reviewer rules apply only once reviewers were assigned through the draft
      // review panel; otherwise the previous unattributed decision still works.
      const context = this.draftReviews.decisionContext(id);
      const reviewed = context.assignedReviewers.length > 0;
      // The validated actor is the normalized one, which is what gets recorded.
      const actor = reviewed
        ? validateDraftReviewDecision({ ...context, revisionAlreadyDecided: false }, {
          actor: request.actor, decision: request.decision,
          draftRevision: request.draftRevision, comment: request.comment ?? null,
        }).actor
        : null;
      const approval: Approval = {
        id: randomUUID(), knowledgeGapId: id, decision: request.decision,
        draftRevision: request.draftRevision, comment: request.comment?.trim() || null, createdAt: now,
      };
      this.db.prepare(`INSERT INTO approvals (id, knowledgeGapId, decision, draftRevision, comment, createdAt, actor)
        VALUES (@id, @knowledgeGapId, @decision, @draftRevision, @comment, @createdAt, @actor)`)
        .run({ ...approval, actor });
      if (reviewed) this.draftReviews.releaseRevision(id);
      if (request.decision !== 'APPROVED') {
        this.db.prepare("UPDATE knowledge_gaps SET status = 'KNOWLEDGE_COLLECTED', updatedAt = ? WHERE id = ?").run(now, id);
        return { approval, gapStatus: 'KNOWLEDGE_COLLECTED', publication: null };
      }
      const article: ApprovedKnowledgeArticle = {
        articleId: randomUUID(), sourceKnowledgeGapId: id, revision: 1,
        title: draft!.title, content: draft!.content, normalizedQuestionKey: row.normalizedQuestionKey,
        approvedDraftRevision: draft!.revision, publishedAt: now,
      };
      this.db.prepare(`INSERT INTO approved_knowledge
        (articleId, sourceKnowledgeGapId, revision, title, content, normalizedQuestionKey, approvedDraftRevision, publishedAt)
        VALUES (@articleId, @sourceKnowledgeGapId, @revision, @title, @content, @normalizedQuestionKey, @approvedDraftRevision, @publishedAt)`).run(article);
      this.db.prepare("UPDATE knowledge_gaps SET status = 'PUBLISHED', updatedAt = ? WHERE id = ?").run(now, id);
      return { approval, gapStatus: 'PUBLISHED', publication: { articleId: article.articleId, articleRevision: article.revision, sourceId: 'nexa-approved' } };
    }).immediate());
  }

  private latestDraft(id: string): DraftRow | undefined {
    return this.db.prepare<[string], DraftRow>('SELECT * FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision DESC LIMIT 1').get(id);
  }

  private assertPublication(row: GapRow, requestedRevision?: number): ApprovedKnowledgeArticle {
    const draft = this.latestDraft(row.id);
    assertFreshDraft(draft, row.evidenceRevision, requestedRevision);
    const article = this.db.prepare<[string], ApprovedKnowledgeArticle>('SELECT * FROM approved_knowledge WHERE sourceKnowledgeGapId = ?').get(row.id);
    const approval = this.db.prepare<[string, number], Approval>('SELECT id, knowledgeGapId, decision, draftRevision, comment, createdAt FROM approvals WHERE knowledgeGapId = ? AND draftRevision = ?').get(row.id, draft!.revision);
    if (!article || approval?.decision !== 'APPROVED' || article.approvedDraftRevision !== draft!.revision
      || article.revision !== 1 || !article.articleId || article.normalizedQuestionKey !== row.normalizedQuestionKey
      || article.title !== draft!.title || article.content !== draft!.content) {
      throw new DomainError('STALE_STATE', 'La publicación no coincide con el borrador aprobado.');
    }
    return article;
  }

  findApprovedKnowledge(normalizedQuestionKey: string): ApprovedKnowledgeArticle | undefined {
    return this.guard(() => this.db.prepare<[string], ApprovedKnowledgeArticle>('SELECT * FROM approved_knowledge WHERE normalizedQuestionKey = ?').get(normalizedQuestionKey));
  }

  listApprovedKnowledge(): ApprovedKnowledgeArticle[] {
    return this.guard(() => this.db.prepare<[], ApprovedKnowledgeArticle>('SELECT * FROM approved_knowledge ORDER BY publishedAt DESC, rowid DESC').all());
  }
}
