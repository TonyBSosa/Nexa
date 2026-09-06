import type { EvidenceReference, OrganizationalRelevance, QuestionAssessmentStatus, SuggestedAction, SuggestedExpert } from './chat.js';

export const knowledgeGapStatuses = [
  'DETECTED', 'TRIAGED', 'ACTION_PROPOSED', 'IN_PROGRESS',
  'KNOWLEDGE_COLLECTED', 'AWAITING_APPROVAL', 'PUBLISHED', 'RESOLVED',
] as const;
export type KnowledgeGapStatus = typeof knowledgeGapStatuses[number];

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
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  occurrences: number;
  suggestedDepartment: string | null;
  suggestedExperts: SuggestedExpert[];
  suggestedActions: SuggestedAction[];
  createdAt: string;
  updatedAt: string;
}
