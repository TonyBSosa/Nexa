import type { ApprovedKnowledgeArticle, ChatResponse } from '@nexa/shared';

// Only use after exact canonical-question lookup in the backend-owned approved store.
export function approvedResponse(queryId: string, article: ApprovedKnowledgeArticle): ChatResponse {
  return {
    queryId, status: 'SUFFICIENT', organizationallyRelevant: true, sufficientKnowledge: true,
    answer: article.content,
    evidence: [{ sourceId: 'nexa-approved', title: article.title, articleId: article.articleId, articleRevision: article.revision }],
  };
}
