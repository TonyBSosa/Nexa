export interface HealthResponse {
  status: 'ok';
  service: 'nexa-api';
}

export {
  knowledgeGapStatuses,
  recoveryActionExecutionStatuses,
  contactAvailabilities,
  activityEventTypes,
} from './knowledge.js';
export type {
  Query, KnowledgeGap, KnowledgeGapDetail, KnowledgeGapStatus, KnowledgeGapPriority,
  RecoveryAction, RecoveryActionExecutionStatus, ContactPerson, ContactAvailability,
  ActivityEvent, ActivityEventType, CollectedEvidence, KnowledgeDraft, Approval, ApprovalDecision,
  ApprovedKnowledgeArticle, PublishedArticleReference, TriageUpdateRequest,
  GapTransitionRequest, AddEvidenceRequest, GenerateDraftRequest, ApprovalRequest,
  ApprovalResult, DraftGenerationInput, DraftGenerationResult,
  UpdateRecoveryActionRequest, CreateManualActionRequest, AddActivityRequest,
} from './knowledge.js';

export type {
  AssessQuestionInput, ChatRequest, ChatResponse, QuestionAssessment, QuestionAssessmentStatus,
  OrganizationalRelevance, EvidenceReference, SuggestedActionType,
  SuggestedAction, SuggestedExpert, ApiErrorResponse,
} from './chat.js';

export type { DashboardSummary, AnalyticsSummary } from './analytics.js';
export type { GapReview, ReviewDetail, ReviewEvent, ReviewMetadata, ReviewDecisionRequest, ReviewDecision, ReviewDisposition, ReviewList, ReviewFilters, SensitivityLevel } from './review.js';

export { evidenceTypes, reviewChecklistKeys } from './draftReview.js';
export type {
  EvidenceType, EvidenceContentKind, EvidenceFileMetadata, EvidenceFileUpload, MeetingDetails,
  EvidenceWithdrawalRecord, EvidenceItem, DiffLine, DiffLineType, LineDiff, DraftRevisionDiff,
  ReviewChecklistKey, ReviewChecklistItem, ReviewChecklistResult, ChecklistConfirmations,
  DraftReviewDecision, DecisionHistoryEntry, DraftReviewComment, DraftReviewState, DraftReviewDetail,
  AssignReviewersRequest, ConfirmChecklistRequest, AddEvidenceItemRequest,
  WithdrawEvidenceRequest, ReplaceEvidenceRequest, AddDraftCommentRequest,
} from './draftReview.js';
