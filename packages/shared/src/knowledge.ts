import type { EvidenceReference, OrganizationalRelevance, QuestionAssessmentStatus, SuggestedActionType, SuggestedExpert } from './chat.js';

export const knowledgeGapStatuses = [
  'DETECTED', 'TRIAGED', 'ACTION_PROPOSED', 'IN_PROGRESS',
  'KNOWLEDGE_COLLECTED', 'AWAITING_APPROVAL', 'PUBLISHED', 'RESOLVED',
] as const;
export type KnowledgeGapStatus = typeof knowledgeGapStatuses[number];
export type KnowledgeGapPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type ApprovalDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export const recoveryActionExecutionStatuses = [
  'PENDING', 'SENT', 'WAITING_RESPONSE', 'RESPONDED', 'COMPLETED', 'CANCELLED',
] as const;
export type RecoveryActionExecutionStatus = typeof recoveryActionExecutionStatuses[number];

export const contactAvailabilities = ['AVAILABLE', 'BUSY', 'AWAY', 'UNKNOWN'] as const;
export type ContactAvailability = typeof contactAvailabilities[number];

export interface ContactPerson {
  id: string;
  name: string;
  title: string;
  department: string;
  email: string;
  phone: string | null;
  availability: ContactAvailability;
}

export const activityEventTypes = [
  'NOTE', 'STATUS_CHANGE', 'RESPONSIBLE_CHANGE', 'DEADLINE_CHANGE',
  'MEETING_UPDATE', 'REQUEST_UPDATE', 'REMINDER', 'CANCEL',
  'STRATEGY_CHANGE', 'ACTION_CREATED', 'ACTION_DISCARDED', 'ACTION_APPROVED',
  'ACTION_SELECTED', 'ACTION_UPDATED',
] as const;
export type ActivityEventType = typeof activityEventTypes[number];

export interface ActivityEvent {
  id: string;
  knowledgeGapId: string;
  type: ActivityEventType;
  summary: string;
  detail: string | null;
  createdAt: string;
}

export interface RecoveryAction {
  id: string;
  type: SuggestedActionType;
  description: string;
  simulated: true;
  humanNote: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  discarded: boolean;
  recipient: string | null;
  subject: string | null;
  objective: string | null;
  dueAt: string | null;
  notes: string | null;
  agenda: string | null;
  meetingLink: string | null;
  meetingAt: string | null;
  participants: string[];
  externalTaskReference: string | null;
  responsible: string | null;
  executionStatus: RecoveryActionExecutionStatus;
  sentAt: string | null;
  respondedAt: string | null;
  responseAttachment: string | null;
  cancelReason: string | null;
  preparedEmailBody: string | null;
  reminderNote: string | null;
}

export interface CollectedEvidence {
  id: string;
  knowledgeGapId: string;
  content: string;
  sourceType: 'MANUAL';
  sourceLabel: string;
  reference: string | null;
  revision: number;
  createdAt: string;
}

export interface PublishedArticleReference {
  articleId: string;
  articleRevision: number;
  sourceId: 'nexa-approved';
}

export interface KnowledgeDraft {
  id: string;
  knowledgeGapId: string;
  revision: number;
  evidenceRevisionUsed: number;
  title: string;
  content: string;
  publication: PublishedArticleReference | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  knowledgeGapId: string;
  decision: ApprovalDecision;
  draftRevision: number;
  comment: string | null;
  createdAt: string;
}

export interface ApprovedKnowledgeArticle {
  articleId: string;
  sourceKnowledgeGapId: string;
  revision: number;
  title: string;
  content: string;
  normalizedQuestionKey: string;
  approvedDraftRevision: number;
  publishedAt: string;
}

export interface Query {
  id: string;
  message: string;
  clientSessionId: string | null;
  normalizedQuestionKey: string | null;
  assessmentStatus: QuestionAssessmentStatus;
  organizationallyRelevant: OrganizationalRelevance;
  sufficientKnowledge: boolean;
  answer: string | null;
  category: string | null;
  evidence: EvidenceReference[];
  knowledgeGapId: string | null;
  countedAsKnowledgeGapOccurrence: boolean;
  createdAt: string;
}

export interface KnowledgeGap {
  id: string;
  originalQuestion: string;
  normalizedQuestionKey: string;
  title: string;
  category: string | null;
  status: KnowledgeGapStatus;
  priority: KnowledgeGapPriority;
  occurrences: number;
  evidenceRevision: number;
  suggestedDepartment: string | null;
  suggestedExperts: SuggestedExpert[];
  suggestedActions: RecoveryAction[];
  selectedAction: RecoveryAction | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeGapDetail extends KnowledgeGap {
  collectedInformation: CollectedEvidence[];
  drafts: KnowledgeDraft[];
  currentDraft: KnowledgeDraft | null;
  approvals: Approval[];
  publishedArticle: ApprovedKnowledgeArticle | null;
  contacts: ContactPerson[];
  activity: ActivityEvent[];
  missingInformation: string;
}

export interface TriageUpdateRequest {
  priority?: KnowledgeGapPriority;
  category?: string;
  suggestedDepartment?: string | null;
  suggestedExperts?: string[];
}

export interface GapTransitionRequest {
  fromStatus: KnowledgeGapStatus;
  toStatus: KnowledgeGapStatus;
  selectedActionId?: string;
  approveSimulatedAction?: true;
  humanNote?: string;
}

export interface AddEvidenceRequest {
  content: string;
  origin: string;
  reference?: string;
}

export type GenerateDraftRequest =
  | { mode: 'GENERATE'; evidenceRevision: number }
  | { mode: 'SAVE'; evidenceRevision: number; title: string; content: string };

export interface ApprovalRequest {
  decision: ApprovalDecision;
  draftRevision: number;
  comment?: string;
  /** Required once reviewers were assigned through the draft review panel. */
  actor?: string;
}

export interface ApprovalResult {
  approval: Approval;
  gapStatus: 'PUBLISHED' | 'RESOLVED' | 'KNOWLEDGE_COLLECTED';
  publication: PublishedArticleReference | null;
}

export interface DraftGenerationInput {
  knowledgeGap: Pick<KnowledgeGap, 'id' | 'title' | 'originalQuestion' | 'category'>;
  evidence: CollectedEvidence[];
  evidenceRevision: number;
}

export type DraftGenerationResult =
  | { status: 'SUCCESS'; title: string; content: string }
  | { status: 'FAILURE' };

export interface UpdateRecoveryActionRequest {
  actionId: string;
  recipient?: string | null;
  subject?: string | null;
  description?: string;
  objective?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  agenda?: string | null;
  meetingLink?: string | null;
  meetingAt?: string | null;
  participants?: string[];
  externalTaskReference?: string | null;
  responsible?: string | null;
  executionStatus?: RecoveryActionExecutionStatus;
  sentAt?: string | null;
  respondedAt?: string | null;
  responseAttachment?: string | null;
  cancelReason?: string | null;
  preparedEmailBody?: string | null;
  reminderNote?: string | null;
  humanNote?: string | null;
}

export interface CreateManualActionRequest {
  type: SuggestedActionType;
  description: string;
  recipient?: string | null;
  subject?: string | null;
  objective?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  agenda?: string | null;
  responsible?: string | null;
}

export interface AddActivityRequest {
  summary: string;
  detail?: string;
  type?: 'NOTE' | 'REMINDER';
}
