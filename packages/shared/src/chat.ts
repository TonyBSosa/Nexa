export type QuestionAssessmentStatus = 'SUFFICIENT' | 'INSUFFICIENT' | 'FAILURE';
export type OrganizationalRelevance = boolean | null;

export interface EvidenceReference {
  sourceId: string;
  title: string;
  documentId?: string;
  locator?: string;
}

export type SuggestedActionType =
  | 'REQUEST_INFORMATION'
  | 'DRAFT_EMAIL'
  | 'PROPOSE_MEETING'
  | 'REQUEST_DOCUMENT'
  | 'CREATE_DOCUMENTATION_TASK';

// Suggestions are role labels and proposals, not identities or executable actions.
export type SuggestedExpert = string;
export interface SuggestedAction {
  type: SuggestedActionType;
  description: string;
}

interface RecoverySuggestions {
  suggestedCategory?: string;
  suggestedDepartment?: string;
  suggestedExperts?: SuggestedExpert[];
  suggestedActions?: SuggestedAction[];
}

export type QuestionAssessment =
  | {
      status: 'SUFFICIENT';
      organizationallyRelevant: true;
      retrievalCompleted: true;
      answer: string;
      evidence: EvidenceReference[];
    }
  | ({
      status: 'INSUFFICIENT';
      organizationallyRelevant: boolean;
      retrievalCompleted: boolean;
      answer: null;
      evidence: EvidenceReference[];
    } & RecoverySuggestions)
  | {
      status: 'FAILURE';
      organizationallyRelevant: null;
      retrievalCompleted: false;
      answer: null;
      evidence: EvidenceReference[];
    };

export interface ChatRequest {
  message: string;
  clientSessionId?: string;
}

export interface ChatResponse extends RecoverySuggestions {
  queryId: string;
  answer: string;
  sufficientKnowledge: boolean;
  status: QuestionAssessmentStatus;
  organizationallyRelevant: OrganizationalRelevance;
  evidence: EvidenceReference[];
  knowledgeGapId?: string;
  error?: { code: 'AGENT_UNAVAILABLE' | 'OUT_OF_SCOPE'; message: string };
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
