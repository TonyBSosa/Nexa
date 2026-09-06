export interface HealthResponse {
  status: 'ok';
  service: 'nexa-api';
}

export type {
  ChatRequest, ChatResponse, QuestionAssessment, QuestionAssessmentStatus,
  OrganizationalRelevance, EvidenceReference, SuggestedActionType,
  SuggestedAction, SuggestedExpert, ApiErrorResponse,
} from './chat.js';
