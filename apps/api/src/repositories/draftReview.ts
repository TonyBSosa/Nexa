import type Database from 'better-sqlite3';
import type {
  AddDraftCommentRequest, AddEvidenceItemRequest, ChecklistConfirmations, DecisionHistoryEntry,
  DraftRevisionDiff, DraftReviewComment, DraftReviewDetail, DraftReviewState, EvidenceItem,
  KnowledgeGapStatus, ReplaceEvidenceRequest, WithdrawEvidenceRequest,
} from '@nexa/shared';
import { randomUUID } from 'node:crypto';
import { evaluateReviewChecklist } from '../domain/reviewChecklist.js';
import { decodeFileContent, validateNewEvidence, validateReplacement, validateWithdrawal } from '../domain/evidenceValidation.js';
import { normalizeActor, validateContentComment, validateReviewerAssignment } from '../domain/reviewRules.js';
import { diffDraftRevisions } from '../domain/revisionDiff.js';
import { DomainError, assertEvidenceAllowed } from '../domain/workflow.js';
import type { EvidenceFileStore } from '../persistence/fileStore.js';

interface GapRow {
  id: string;
  status: KnowledgeGapStatus;
  evidenceRevision: number;
}

interface EvidenceRow {
  id: string;
  knowledgeGapId: string;
  content: string;
  sourceLabel: string;
  reference: string | null;
  revision: number;
  createdAt: string;
  evidenceType: string;
  contentKind: string;
  author: string | null;
  evidenceDate: string | null;
  note: string | null;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  meeting: string | null;
  version: number;
  supersededBy: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawalJustification: string | null;
}

interface DraftRow {
  revision: number;
  title: string;
  content: string;
  evidenceRevisionUsed: number;
}

interface StateRow {
  revision: number;
  submittedBy: string | null;
  submittedAt: string | null;
  revisionUnderReview: number | null;
  assignedReviewers: string;
  confirmations: string;
}

const noConfirmations: ChecklistConfirmations = {
  answerClear: false, noImproperConfidentialInfo: false, readyForReview: false,
};

/** Endpoints that serve the stored bytes for viewing and downloading. */
function fileLinks(gapId: string, evidenceId: string) {
  return {
    viewUrl: `/api/knowledge-gaps/${gapId}/evidence/${evidenceId}/file`,
    downloadUrl: `/api/knowledge-gaps/${gapId}/evidence/${evidenceId}/file?download=1`,
  };
}

function toEvidenceItem(row: EvidenceRow): EvidenceItem {
  return {
    id: row.id,
    knowledgeGapId: row.knowledgeGapId,
    type: row.evidenceType as EvidenceItem['type'],
    contentKind: row.contentKind as EvidenceItem['contentKind'],
    version: row.version,
    revision: row.revision,
    source: row.sourceLabel,
    author: row.author,
    evidenceDate: row.evidenceDate,
    reference: row.reference,
    note: row.note,
    content: row.content === '' ? null : row.content,
    url: row.url,
    file: row.fileName && row.mimeType && row.sizeBytes !== null
      ? { fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, ...fileLinks(row.knowledgeGapId, row.id) }
      : null,
    meeting: row.meeting ? JSON.parse(row.meeting) as EvidenceItem['meeting'] : null,
    withdrawal: row.withdrawnAt && row.withdrawnBy && row.withdrawalJustification
      ? { actor: row.withdrawnBy, justification: row.withdrawalJustification, withdrawnAt: row.withdrawnAt }
      : null,
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
  };
}

export class DraftReviewStore {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date,
    private readonly files: EvidenceFileStore,
  ) {}

  private gap(id: string): GapRow {
    const gap = this.db.prepare<[string], GapRow>('SELECT id, status, evidenceRevision FROM knowledge_gaps WHERE id = ?').get(id);
    if (!gap) throw new DomainError('NOT_FOUND', 'Brecha no encontrada.');
    return gap;
  }

  private evidenceRows(id: string): EvidenceRow[] {
    return this.db.prepare<[string], EvidenceRow>('SELECT * FROM collected_evidence WHERE knowledgeGapId = ? ORDER BY revision').all(id);
  }

  private latestDraft(id: string): DraftRow | undefined {
    return this.db.prepare<[string], DraftRow>(
      'SELECT revision, title, content, evidenceRevisionUsed FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision DESC LIMIT 1',
    ).get(id);
  }

  state(id: string): DraftReviewState {
    const row = this.db.prepare<[string], StateRow>('SELECT * FROM draft_reviews WHERE knowledgeGapId = ?').get(id);
    if (!row) {
      return {
        revision: 0, submittedBy: null, submittedAt: null, revisionUnderReview: null,
        assignedReviewers: [], confirmations: { ...noConfirmations },
      };
    }
    return {
      revision: row.revision,
      submittedBy: row.submittedBy,
      submittedAt: row.submittedAt,
      revisionUnderReview: row.revisionUnderReview,
      assignedReviewers: JSON.parse(row.assignedReviewers) as string[],
      confirmations: JSON.parse(row.confirmations) as ChecklistConfirmations,
    };
  }

  private write(id: string, state: DraftReviewState): void {
    state.revision++;
    this.db.prepare(`INSERT INTO draft_reviews
      (knowledgeGapId, revision, submittedBy, submittedAt, revisionUnderReview, assignedReviewers, confirmations)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(knowledgeGapId) DO UPDATE SET revision = excluded.revision, submittedBy = excluded.submittedBy,
        submittedAt = excluded.submittedAt, revisionUnderReview = excluded.revisionUnderReview,
        assignedReviewers = excluded.assignedReviewers, confirmations = excluded.confirmations`)
      .run(id, state.revision, state.submittedBy, state.submittedAt, state.revisionUnderReview,
        JSON.stringify(state.assignedReviewers), JSON.stringify(state.confirmations));
    this.db.prepare('UPDATE knowledge_gaps SET updatedAt = ? WHERE id = ?').run(this.now().toISOString(), id);
  }

  private fresh(state: DraftReviewState, revision: number): void {
    if (state.revision !== revision) {
      throw new DomainError('STALE_STATE', 'La revisión cambió. Actualice el detalle antes de continuar.');
    }
  }

  /** Every evidence change advances the gap revision, which marks the draft stale. */
  private bumpEvidenceRevision(id: string, at: string): number {
    const next = this.gap(id).evidenceRevision + 1;
    this.db.prepare('UPDATE knowledge_gaps SET evidenceRevision = ?, updatedAt = ? WHERE id = ?').run(next, at, id);
    return next;
  }

  /**
   * Drafts are generated from the evidence of a revision, so every active piece
   * collected up to that revision counts as cited.
   */
  private citedEvidenceIds(id: string, draft: DraftRow): string[] {
    return this.evidenceRows(id)
      .filter(row => row.supersededBy === null && row.withdrawnAt === null && row.revision <= draft.evidenceRevisionUsed)
      .map(row => row.id);
  }

  checklist(id: string) {
    const draft = this.latestDraft(id);
    const state = this.state(id);
    return evaluateReviewChecklist({
      evidence: this.evidenceRows(id)
        .filter(row => row.supersededBy === null)
        .map(row => ({ id: row.id, source: row.sourceLabel, withdrawn: row.withdrawnAt !== null })),
      draft: draft ? { title: draft.title, content: draft.content, citedEvidenceIds: this.citedEvidenceIds(id, draft) } : null,
      confirmations: state.confirmations,
    });
  }

  private diff(id: string): DraftRevisionDiff | null {
    const drafts = this.db.prepare<[string], DraftRow>(
      'SELECT revision, title, content, evidenceRevisionUsed FROM knowledge_drafts WHERE knowledgeGapId = ? ORDER BY revision DESC LIMIT 2',
    ).all(id);
    const [latest, previous] = drafts;
    if (!latest || !previous) return null;
    return diffDraftRevisions(previous, latest);
  }

  detail(id: string): DraftReviewDetail {
    this.gap(id);
    return {
      state: this.state(id),
      checklist: this.checklist(id),
      evidence: this.evidenceRows(id).map(toEvidenceItem),
      history: this.db.prepare<[string], DecisionHistoryEntry>(
        'SELECT id, draftRevision, decision, actor, comment, createdAt FROM approvals WHERE knowledgeGapId = ? ORDER BY draftRevision DESC, rowid DESC',
      ).all(id),
      comments: this.db.prepare<[string], DraftReviewComment>(
        'SELECT id, knowledgeGapId, draftRevision, actor, startLine, endLine, quote, body, createdAt FROM draft_review_comments WHERE knowledgeGapId = ? ORDER BY draftRevision, id',
      ).all(id),
      diff: this.diff(id),
    };
  }

  private insertActivity(id: string, summary: string, detail: string | null, at: string): void {
    this.db.prepare('INSERT INTO recovery_activity (id, knowledgeGapId, type, summary, detail, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), id, 'NOTE', summary, detail, at);
  }

  addEvidence(id: string, input: AddEvidenceItemRequest): DraftReviewDetail {
    const gap = this.gap(id);
    assertEvidenceAllowed(gap.status);
    const evidence = validateNewEvidence(input, this.now());
    const evidenceId = randomUUID();
    // Bytes are written first; the database transaction below undoes the file if
    // it fails, because the file system takes no part in the transaction.
    const bytes = evidence.file ? decodeFileContent(evidence.file, (input as { file?: unknown }).file) : null;
    if (bytes) this.files.write(id, evidenceId, bytes);
    try {
      return this.insertEvidence(id, evidenceId, evidence);
    } catch (error) {
      if (bytes) this.files.remove(id, evidenceId);
      throw error;
    }
  }

  private insertEvidence(id: string, evidenceId: string, evidence: ReturnType<typeof validateNewEvidence>): DraftReviewDetail {
    return this.db.transaction(() => {
      const createdAt = this.now().toISOString();
      const revision = this.bumpEvidenceRevision(id, createdAt);
      this.db.prepare(`INSERT INTO collected_evidence
        (id, knowledgeGapId, content, sourceType, sourceLabel, reference, revision, createdAt, evidenceType,
         contentKind, author, evidenceDate, note, url, fileName, mimeType, sizeBytes, meeting, version,
         supersededBy, withdrawnAt, withdrawnBy, withdrawalJustification)
        VALUES (@id, @knowledgeGapId, @content, 'MANUAL', @sourceLabel, @reference, @revision, @createdAt,
         @evidenceType, @contentKind, @author, @evidenceDate, @note, @url, @fileName, @mimeType, @sizeBytes,
         @meeting, 1, NULL, NULL, NULL, NULL)`).run({
        id: evidenceId, knowledgeGapId: id, content: evidence.content ?? '',
        sourceLabel: evidence.source, reference: evidence.reference, revision, createdAt,
        evidenceType: evidence.type, contentKind: evidence.contentKind, author: evidence.author,
        evidenceDate: evidence.evidenceDate, note: evidence.note, url: evidence.url,
        fileName: evidence.file?.fileName ?? null, mimeType: evidence.file?.mimeType ?? null,
        sizeBytes: evidence.file?.sizeBytes ?? null,
        meeting: evidence.meeting ? JSON.stringify(evidence.meeting) : null,
      });
      this.insertActivity(id, `Se registró evidencia (revisión ${revision}).`, evidence.source, createdAt);
      return this.detail(id);
    }).immediate();
  }

  private currentEvidence(id: string, evidenceId: string): EvidenceRow {
    const row = this.db.prepare<[string, string], EvidenceRow>('SELECT * FROM collected_evidence WHERE knowledgeGapId = ? AND id = ?').get(id, evidenceId);
    if (!row) throw new DomainError('NOT_FOUND', 'Evidencia no encontrada.');
    return row;
  }

  private versionState(row: EvidenceRow) {
    return {
      type: row.evidenceType as EvidenceItem['type'],
      version: row.version,
      withdrawnAt: row.withdrawnAt,
      supersededBy: row.supersededBy,
    };
  }

  withdrawEvidence(id: string, evidenceId: string, input: WithdrawEvidenceRequest): DraftReviewDetail {
    return this.db.transaction(() => {
      const gap = this.gap(id);
      assertEvidenceAllowed(gap.status);
      const row = this.currentEvidence(id, evidenceId);
      const withdrawal = validateWithdrawal(this.versionState(row), input);
      const at = this.now().toISOString();
      this.db.prepare('UPDATE collected_evidence SET withdrawnAt = ?, withdrawnBy = ?, withdrawalJustification = ? WHERE id = ?')
        .run(at, withdrawal.actor, withdrawal.justification, evidenceId);
      this.bumpEvidenceRevision(id, at);
      this.insertActivity(id, `${withdrawal.actor} retiró evidencia.`, withdrawal.justification, at);
      return this.detail(id);
    }).immediate();
  }

  replaceEvidence(id: string, evidenceId: string, input: ReplaceEvidenceRequest): DraftReviewDetail {
    const gap = this.gap(id);
    assertEvidenceAllowed(gap.status);
    const row = this.currentEvidence(id, evidenceId);
    const replacement = validateReplacement(this.versionState(row), input);
    const replacementId = randomUUID();
    const bytes = decodeFileContent(replacement.file, (input as { file?: unknown }).file);
    this.files.write(id, replacementId, bytes);
    try {
      return this.insertReplacement(id, evidenceId, replacementId, row, replacement);
    } catch (error) {
      this.files.remove(id, replacementId);
      throw error;
    }
  }

  private insertReplacement(
    id: string, evidenceId: string, replacementId: string,
    row: EvidenceRow, replacement: ReturnType<typeof validateReplacement>,
  ): DraftReviewDetail {
    return this.db.transaction(() => {
      const createdAt = this.now().toISOString();
      const revision = this.bumpEvidenceRevision(id, createdAt);
      this.db.prepare(`INSERT INTO collected_evidence
        (id, knowledgeGapId, content, sourceType, sourceLabel, reference, revision, createdAt, evidenceType,
         contentKind, author, evidenceDate, note, url, fileName, mimeType, sizeBytes, meeting, version,
         supersededBy, withdrawnAt, withdrawnBy, withdrawalJustification)
        VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL)`)
        .run(replacementId, id, row.content, row.sourceLabel, row.reference, revision, createdAt,
          row.evidenceType, row.contentKind, replacement.actor, row.evidenceDate, replacement.reason,
          replacement.file.fileName, replacement.file.mimeType, replacement.file.sizeBytes, replacement.version);
      this.db.prepare('UPDATE collected_evidence SET supersededBy = ? WHERE id = ?').run(replacementId, evidenceId);
      this.insertActivity(id, `${replacement.actor} reemplazó evidencia (versión ${replacement.version}).`, replacement.reason, createdAt);
      return this.detail(id);
    }).immediate();
  }

  confirmChecklist(id: string, revision: number, confirmations: ChecklistConfirmations): DraftReviewDetail {
    return this.db.transaction(() => {
      this.gap(id);
      const state = this.state(id);
      this.fresh(state, revision);
      state.confirmations = confirmations;
      this.write(id, state);
      return this.detail(id);
    }).immediate();
  }

  assignReviewers(id: string, revision: number, submittedBy: string, reviewers: unknown): DraftReviewDetail {
    return this.db.transaction(() => {
      this.gap(id);
      const state = this.state(id);
      this.fresh(state, revision);
      const author = normalizeActor(submittedBy, 'submittedBy');
      const draft = this.latestDraft(id);
      if (!draft) throw new DomainError('INVALID_TRANSITION', 'Genere un borrador antes de asignar revisores.');
      state.assignedReviewers = validateReviewerAssignment(author, [author], reviewers);
      state.submittedBy = author;
      state.submittedAt = this.now().toISOString();
      state.revisionUnderReview = draft.revision;
      this.write(id, state);
      return this.detail(id);
    }).immediate();
  }

  addComment(id: string, input: AddDraftCommentRequest): DraftReviewDetail {
    return this.db.transaction(() => {
      this.gap(id);
      const state = this.state(id);
      const draft = this.latestDraft(id);
      const comment = validateContentComment(
        { revisionUnderReview: state.revisionUnderReview, draftContent: draft?.content ?? '' },
        input,
      );
      this.db.prepare(`INSERT INTO draft_review_comments
        (id, knowledgeGapId, draftRevision, actor, startLine, endLine, quote, body, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, comment.draftRevision, comment.actor, comment.startLine, comment.endLine,
          comment.quote, comment.body, this.now().toISOString());
      return this.detail(id);
    }).immediate();
  }

  /** Bytes plus the name and type the browser needs to display or save them. */
  readFile(id: string, evidenceId: string) {
    this.gap(id);
    const row = this.currentEvidence(id, evidenceId);
    if (!row.fileName || !row.mimeType) throw new DomainError('NOT_FOUND', 'Esta evidencia no tiene archivo.');
    return { bytes: this.files.read(id, evidenceId), fileName: row.fileName, mimeType: row.mimeType };
  }

  /** Context for the domain decision rules, read by the knowledge repository during approval. */
  decisionContext(id: string) {
    const state = this.state(id);
    return {
      revisionUnderReview: state.revisionUnderReview,
      submittedBy: state.submittedBy ?? '',
      draftAuthors: state.submittedBy ? [state.submittedBy] : [],
      assignedReviewers: state.assignedReviewers,
    };
  }

  /** After a decision the locked revision is released so a new one can be submitted. */
  releaseRevision(id: string): void {
    const state = this.state(id);
    if (state.revisionUnderReview === null) return;
    state.revisionUnderReview = null;
    state.assignedReviewers = [];
    this.write(id, state);
  }
}
