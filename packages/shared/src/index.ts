export interface HealthResponse {
  status: 'ok';
  service: 'nexa-api';
}

export { knowledgeGapStatuses } from './knowledge.js';
export type {
  Query, KnowledgeGap, KnowledgeGapDetail, KnowledgeGapStatus, KnowledgeGapPriority,
  RecoveryAction, CollectedEvidence, KnowledgeDraft, Approval, ApprovalDecision,
  ApprovedKnowledgeArticle, PublishedArticleReference, TriageUpdateRequest,
  GapTransitionRequest, AddEvidenceRequest, GenerateDraftRequest, ApprovalRequest,
  ApprovalResult, DraftGenerationInput, DraftGenerationResult,
} from './knowledge.js';

export type {
  AssessQuestionInput, ChatRequest, ChatResponse, QuestionAssessment, QuestionAssessmentStatus,
  OrganizationalRelevance, EvidenceReference, SuggestedActionType,
  SuggestedAction, SuggestedExpert, ApiErrorResponse,
} from './chat.js';

export type { DashboardSummary, AnalyticsSummary } from './analytics.js';
