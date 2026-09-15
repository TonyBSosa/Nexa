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
