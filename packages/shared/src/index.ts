export interface HealthResponse {
  status: 'ok';
  service: 'nexa-api';
}

export { knowledgeGapStatuses } from './knowledge.js';
export type { Query, KnowledgeGap, KnowledgeGapStatus } from './knowledge.js';

export type {
  ChatRequest, ChatResponse, QuestionAssessment, QuestionAssessmentStatus,
  OrganizationalRelevance, EvidenceReference, SuggestedActionType,
  SuggestedAction, SuggestedExpert, ApiErrorResponse,
} from './chat.js';
