import { knowledgeGapStatuses } from '@nexa/shared';
import type { AnalyticsSummary, KnowledgeGapStatus } from '@nexa/shared';
import type { KnowledgeRepository } from '../repositories/knowledge.js';

// Synchronous repository reads share the same event-loop turn; no provider or domain writes.
export function getAnalytics(repository: KnowledgeRepository): AnalyticsSummary {
  const attempts = repository.listQueries();
  const queries = attempts.filter(query => query.organizationallyRelevant === true && query.assessmentStatus !== 'FAILURE');
  const gaps = repository.listGaps();
  const articles = repository.listApprovedKnowledge();
  const gapsByStatus = Object.fromEntries(knowledgeGapStatuses.map(status => [status, 0])) as Record<KnowledgeGapStatus, number>;
  for (const gap of gaps) gapsByStatus[gap.status]++;
  const answeredQueries = queries.filter(query => query.assessmentStatus === 'SUFFICIENT').length;
  const categories = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const query of queries) {
    const category = query.category ?? 'Unclassified';
    categories.set(category, (categories.get(category) ?? 0) + 1);
    for (const sourceId of new Set(query.evidence.map(reference => reference.sourceId))) {
      sources.set(sourceId, (sources.get(sourceId) ?? 0) + 1);
    }
  }
  return {
    totalQueries: queries.length,
    totalAttempts: attempts.length,
    organizationalQueries: queries.length,
    answeredQueries,
    insufficientQueries: queries.length - answeredQueries,
    openGaps: gaps.length - gapsByStatus.RESOLVED,
    resolvedGaps: gapsByStatus.RESOLVED,
    inRecoveryGaps: gapsByStatus.IN_PROGRESS + gapsByStatus.KNOWLEDGE_COLLECTED + gapsByStatus.AWAITING_APPROVAL,
    publishedKnowledge: articles.length,
    totalGapOccurrences: gaps.reduce((total, gap) => total + gap.occurrences, 0),
    queryAnswerRate: queries.length ? answeredQueries / queries.length : null,
    gapResolutionRate: gaps.length ? gapsByStatus.RESOLVED / gaps.length : null,
    gapsByStatus,
    frequentOpenGaps: gaps.filter(gap => gap.status !== 'RESOLVED' && gap.occurrences > 1)
      .sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id)).slice(0, 5),
    recentActivity: queries.slice(0, 5),
    categories: [...categories].map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    sourceUsage: [...sources].map(([sourceId, queryCount]) => ({ sourceId, queryCount }))
      .sort((a, b) => b.queryCount - a.queryCount || a.sourceId.localeCompare(b.sourceId)),
  };
}
