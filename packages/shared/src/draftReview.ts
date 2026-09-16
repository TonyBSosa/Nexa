import type { ApprovalDecision } from './knowledge.js';

// Contracts for evidence collection and draft review. The API domain modules
// and the web review panels share these shapes.

export const evidenceTypes = [
  'MANUAL_TEXT', 'MEETING_NOTES', 'TRANSCRIPT', 'PDF', 'DOCUMENT', 'IMAGE', 'LINK', 'VIDEO', 'VIDEO_LINK', 'SNIPPET',
] as const;
export type EvidenceType = typeof evidenceTypes[number];
export type EvidenceContentKind = 'TEXT' | 'MEETING' | 'FILE' | 'URL';

export interface EvidenceFileMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Metadata plus the base64 bytes, used when adding or replacing a file. */
export interface EvidenceFileUpload extends EvidenceFileMetadata {
  content: string;
}

export interface MeetingDetails {
  participants: string[];
  summary: string;
  agreements: string[];
  transcript: string | null;
  recordingUrl: string | null;
}

export interface EvidenceWithdrawalRecord {
  actor: string;
  justification: string;
  withdrawnAt: string;
}

export interface EvidenceItem {
  id: string;
  knowledgeGapId: string;
  type: EvidenceType;
  contentKind: EvidenceContentKind;
  version: number;
  revision: number;
  source: string;
  author: string | null;
  evidenceDate: string | null;
  reference: string | null;
  note: string | null;
  content: string | null;
  url: string | null;
  file: (EvidenceFileMetadata & { viewUrl: string; downloadUrl: string }) | null;
  meeting: MeetingDetails | null;
  withdrawal: EvidenceWithdrawalRecord | null;
  supersededBy: string | null;
  createdAt: string;
}

export type DiffLineType = 'EQUAL' | 'ADDED' | 'REMOVED';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

export interface DraftRevisionDiff {
  fromRevision: number;
  toRevision: number;
  titleChanged: boolean;
  title: { before: string; after: string };
  content: LineDiff;
}

export const reviewChecklistKeys = [
  'HAS_EVIDENCE', 'SOURCES_IDENTIFIED', 'ANSWER_CLEAR', 'NO_IMPROPER_CONFIDENTIAL_INFO', 'READY_FOR_REVIEW',
] as const;
export type ReviewChecklistKey = typeof reviewChecklistKeys[number];

export interface ReviewChecklistItem {
  key: ReviewChecklistKey;
  label: string;
  kind: 'AUTOMATIC' | 'CONFIRMATION';
  satisfied: boolean;
  reason: string | null;
}

export interface ReviewChecklistResult {
  items: ReviewChecklistItem[];
  complete: boolean;
}

export interface ChecklistConfirmations {
  answerClear: boolean;
  noImproperConfidentialInfo: boolean;
  readyForReview: boolean;
}

export interface DraftReviewDecision {
  actor: string;
  decision: ApprovalDecision;
  draftRevision: number;
  comment: string | null;
}

export interface DecisionHistoryEntry {
  id: string;
  draftRevision: number;
  decision: ApprovalDecision;
  actor: string | null;
  comment: string | null;
  createdAt: string;
}

export interface DraftReviewComment {
  id: string;
  knowledgeGapId: string;
  draftRevision: number;
  actor: string;
  startLine: number | null;
  endLine: number | null;
  quote: string | null;
  body: string;
  createdAt: string;
}

export interface DraftReviewState {
  revision: number;
  submittedBy: string | null;
  submittedAt: string | null;
  revisionUnderReview: number | null;
  assignedReviewers: string[];
  confirmations: ChecklistConfirmations;
}

export interface DraftReviewDetail {
  state: DraftReviewState;
  checklist: ReviewChecklistResult;
  evidence: EvidenceItem[];
  history: DecisionHistoryEntry[];
  comments: DraftReviewComment[];
  diff: DraftRevisionDiff | null;
}

export interface AssignReviewersRequest {
  revision: number;
  submittedBy: string;
  reviewers: string[];
}

export interface ConfirmChecklistRequest {
  revision: number;
  confirmations: ChecklistConfirmations;
}

export interface AddEvidenceItemRequest {
  type: EvidenceType;
  source: string;
  author: string;
  evidenceDate: string;
  reference?: string | null;
  note?: string | null;
  content?: string | null;
  url?: string | null;
  file?: EvidenceFileUpload | null;
  meeting?: MeetingDetails | null;
}

export interface WithdrawEvidenceRequest {
  actor: string;
  justification: string;
}

export interface ReplaceEvidenceRequest {
  actor: string;
  reason: string;
  file: EvidenceFileUpload;
}

export interface AddDraftCommentRequest {
  actor: string;
  draftRevision: number;
  startLine?: number | null;
  endLine?: number | null;
  quote?: string | null;
  body: string;
}
