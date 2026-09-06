import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AddEvidenceRequest, Approval, ApprovalRequest, ApprovalResult, ApprovedKnowledgeArticle,
  ChatResponse, CollectedEvidence, GapTransitionRequest, KnowledgeDraft, KnowledgeGap,
  KnowledgeGapDetail, KnowledgeGapStatus, Query, RecoveryAction, TriageUpdateRequest,
} from '@nexa/shared';
import { questionKey } from '../domain/questionKey.js';
import { approvedResponse } from '../domain/approvedKnowledge.js';
import { isObject, isUsableAction, nonempty, recoveryProposals } from '../domain/recoveryActions.js';
import {
  assertApprovalAllowed, assertDraftAllowed, assertEvidenceAllowed, assertOperationTransition,
  assertFreshDraft, assertTriageAllowed, DomainError, requireStatus,
} from '../domain/workflow.js';

export class PersistenceError extends Error {
  constructor() { super('No se pudo guardar o leer la información.'); }
}

export interface KnowledgeRepository {
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
  if (!isUsableAction(value) || !isObject(value)) throw new PersistenceError();
  for (const key of ['id', 'createdAt', 'updatedAt']) {
    if (value[key] !== undefined && !nonempty(value[key])) throw new PersistenceError();
  }
  for (const key of ['humanNote', 'approvedAt']) {
    if (value[key] !== undefined && value[key] !== null && !nonempty(value[key])) throw new PersistenceError();
  }
  if (value.simulated !== undefined && value.simulated !== true) throw new PersistenceError();
  return {
    id: nonempty(value.id) ? value.id : `${gap.id}-action-${index + 1}`,
    type: value.type,
    description: value.description.trim(),
    simulated: true,
    humanNote: nonempty(value.humanNote) ? value.humanNote : null,
    createdAt: nonempty(value.createdAt) ? value.createdAt : gap.createdAt,
    updatedAt: nonempty(value.updatedAt) ? value.updatedAt : gap.createdAt,
    approvedAt: nonempty(value.approvedAt) ? value.approvedAt : null,
  };
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
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}

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

  record(message: string, response: ChatResponse, gapEligible: boolean, clientSessionId?: string): Query {
    return this.guard(() => this.db.transaction(() => {
      // BEGIN IMMEDIATE serializes this final lookup and query/gap writes with publication.
      // Canonical approved content is authoritative even if the provider result is older.
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
          const proposed = recoveryProposals(response.suggestedActions);
          const actions: RecoveryAction[] = proposed.map((action) => ({
            ...action, id: randomUUID(), simulated: true, humanNote: null,
            createdAt, updatedAt: createdAt, approvedAt: null,
          }));
          this.db.prepare(`INSERT INTO knowledge_gaps
            (id, originalQuestion, normalizedQuestionKey, title, category, status, priority, occurrences, evidenceRevision, suggestedDepartment, suggestedExperts, suggestedActions, selectedAction, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, 'DETECTED', 'MEDIUM', 1, 0, ?, ?, ?, NULL, ?, ?)`)
            .run(gapId, message, key, message, response.suggestedCategory ?? null,
              response.suggestedDepartment ?? null, JSON.stringify(response.suggestedExperts ?? []),
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
      const collectedInformation = this.db.prepare<[string], CollectedEvidence>('SELECT * FROM collected_evidence WHERE knowledgeGapId = ? ORDER BY revision').all(id);
      const article = this.db.prepare<[string], ApprovedKnowledgeArticle>('SELECT * FROM approved_knowledge WHERE sourceKnowledgeGapId = ?').get(id) ?? null;
      const drafts = this.db.prepare<[string], DraftRow>('SELECT * FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision').all(id).map((draft) => ({
        ...draft,
        publication: article?.approvedDraftRevision === draft.revision
          ? { articleId: article.articleId, articleRevision: article.revision, sourceId: 'nexa-approved' as const } : null,
      }));
      return {
        ...gapFromRow(row), collectedInformation, drafts, currentDraft: drafts.at(-1) ?? null,
        approvals: this.db.prepare<[string], Approval>('SELECT * FROM approvals WHERE knowledgeGapId = ? ORDER BY createdAt, rowid').all(id),
        publishedArticle: article,
      };
    });
  }

  triage(id: string, update: TriageUpdateRequest): KnowledgeGap {
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      assertTriageAllowed(row.status);
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
    return this.guard(() => this.db.transaction(() => {
      const row = this.gapRow(id);
      requireStatus(row.status, request.fromStatus);
      assertOperationTransition(request.fromStatus, request.toStatus);
      const now = this.now().toISOString();
      let selectedAction = row.selectedAction;
      const gap = gapFromRow(row);
      if (request.toStatus === 'ACTION_PROPOSED') {
        if (!gap.suggestedActions.some(isUsableAction)) throw new DomainError('INVALID_TRANSITION', 'Se requiere una propuesta utilizable.');
        if (request.selectedActionId) {
          const action = gap.suggestedActions.find((candidate) => candidate.id === request.selectedActionId);
          if (!action) throw new DomainError('INVALID_REQUEST', 'La acción seleccionada no pertenece a esta brecha.');
          selectedAction = JSON.stringify({ ...action, humanNote: request.humanNote?.trim() || null, updatedAt: now });
        }
      }
      if (request.toStatus === 'IN_PROGRESS') {
        if (request.approveSimulatedAction !== true || !request.selectedActionId) {
          throw new DomainError('APPROVAL_REQUIRED', 'Se requiere aprobación humana explícita de la acción simulada.');
        }
        const action = gap.suggestedActions.find((candidate) => candidate.id === request.selectedActionId);
        if (!action) throw new DomainError('INVALID_REQUEST', 'La acción seleccionada no pertenece a esta brecha.');
        selectedAction = JSON.stringify({ ...action, humanNote: request.humanNote?.trim() || action.humanNote, approvedAt: now, updatedAt: now });
      }
      if (request.toStatus === 'KNOWLEDGE_COLLECTED' && row.evidenceRevision < 1) {
        throw new DomainError('INVALID_TRANSITION', 'Recopile evidencia antes de avanzar.');
      }
      if (request.toStatus === 'AWAITING_APPROVAL') {
        const draft = this.latestDraft(id);
        assertFreshDraft(draft, row.evidenceRevision);
        const reviewed = this.db.prepare<[string], { revision: number }>('SELECT COALESCE(MAX(draftRevision), 0) AS revision FROM approvals WHERE knowledgeGapId = ?').get(id)!;
        if (draft!.revision <= reviewed.revision) throw new DomainError('STALE_STATE', 'Genere una revisión nueva antes de enviarla.');
      }
      if (request.toStatus === 'RESOLVED') this.assertPublication(row);
      const selected = selectedAction ? actionFromUnknown(JSON.parse(selectedAction), row, 0) : null;
      const actions = gap.suggestedActions.map((action) => selected?.id === action.id ? selected : action);
      this.db.prepare('UPDATE knowledge_gaps SET status = ?, selectedAction = ?, suggestedActions = ?, updatedAt = ? WHERE id = ?')
        .run(request.toStatus, selectedAction, JSON.stringify(actions), now, id);
      return { id, status: request.toStatus, updatedAt: now };
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
      const prior = this.db.prepare<[string, number], Approval>('SELECT * FROM approvals WHERE knowledgeGapId = ? AND draftRevision = ?').get(id, request.draftRevision);
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
      const approval: Approval = {
        id: randomUUID(), knowledgeGapId: id, decision: request.decision,
        draftRevision: request.draftRevision, comment: request.comment?.trim() || null, createdAt: now,
      };
      this.db.prepare(`INSERT INTO approvals (id, knowledgeGapId, decision, draftRevision, comment, createdAt)
        VALUES (@id, @knowledgeGapId, @decision, @draftRevision, @comment, @createdAt)`).run(approval);
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
    const approval = this.db.prepare<[string, number], Approval>('SELECT * FROM approvals WHERE knowledgeGapId = ? AND draftRevision = ?').get(row.id, draft!.revision);
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
