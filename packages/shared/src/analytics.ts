import type { KnowledgeGap, KnowledgeGapStatus, Query } from './knowledge.js';

export interface DashboardSummary {
  /** Accepted organizational queries only: answered + insufficient. */
  totalQueries: number;
  totalAttempts: number;
  organizationalQueries: number;
  answeredQueries: number;
  insufficientQueries: number;
  openGaps: number;
  resolvedGaps: number;
  inRecoveryGaps: number;
  publishedKnowledge: number;
  totalGapOccurrences: number;
  queryAnswerRate: number | null;
  gapResolutionRate: number | null;
  gapsByStatus: Record<KnowledgeGapStatus, number>;
  frequentOpenGaps: KnowledgeGap[];
  recentActivity: Query[];
}

export interface AnalyticsSummary extends DashboardSummary {
  categories: Array<{ category: string; count: number }>;
  sourceUsage: Array<{ sourceId: string; queryCount: number }>;
}
