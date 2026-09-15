import type { KnowledgeGap } from './knowledge.js';

export type ReviewDisposition = 'PENDING' | 'ACCEPTED' | 'DISCARDED' | 'DUPLICATE';
export type SensitivityLevel = 'NORMAL' | 'INTERNAL' | 'SENSITIVE';
export type ReviewDecision = 'ACCEPT' | 'DISCARD_NOT_APPLICABLE' | 'DISCARD_SENSITIVE' | 'DISCARD_IMPROPER' | 'DUPLICATE' | 'RESTORE' | 'RETURN';

export interface GapReview {
  revision: number;
  disposition: ReviewDisposition;
  reason: string | null;
  duplicateOf: string | null;
  responsible: string | null;
  sensitivity: SensitivityLevel;
  targetDate: string | null;
  importance: string | null;
  relatedGapIds: string[];
  relatedArticleIds: string[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  classifiedBy: string | null;
  classifiedAt: string | null;
}

export interface ReviewEvent {
  id: number;
  action: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

export interface ReviewDetail {
  review: GapReview;
  history: ReviewEvent[];
  sensitiveWarning: boolean;
  origin: string;
  similarGaps: Array<Pick<KnowledgeGap, 'id' | 'title' | 'status'>>;
}

export interface ReviewMetadata {
  revision: number;
  title: string;
  category: string;
  priority: KnowledgeGap['priority'];
  department: string;
  responsible: string;
  experts: string[];
  sensitivity: SensitivityLevel;
  targetDate: string | null;
  importance: string;
  relatedGapIds: string[];
  relatedArticleIds: string[];
}

export interface ReviewDecisionRequest {
  revision: number;
  decision: ReviewDecision;
  actor: string;
  reason?: string;
  duplicateOf?: string;
}

export interface ReviewList {
  items: Array<KnowledgeGap & { reviewDisposition: ReviewDisposition }>;
  total: number;
  page: number;
  pageSize: number;
}

export interface ReviewFilters {
  page: number;
  pageSize: number;
  q?: string;
  disposition?: ReviewDisposition;
  priority?: KnowledgeGap['priority'];
  department?: string;
  status?: KnowledgeGap['status'];
  from?: string;
  to?: string;
}
