import type { ReviewMetadata } from '@nexa/shared';
import type { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';

export function metadataFor(repository: SQLiteKnowledgeRepository, id: string): ReviewMetadata {
  const gap = repository.getGap(id)!;
  return { revision: repository.getReview(id).review.revision, title: gap.title, category: gap.category ?? 'TI', priority: gap.priority,
    department: 'Soporte TI', responsible: 'Coordinador sintético', experts: ['Técnico sintético'], sensitivity: 'INTERNAL', targetDate: '2026-10-01',
    importance: 'Reducir incidentes repetitivos de equipos.', relatedGapIds: [], relatedArticleIds: [] };
}

export function acceptAndClassify(repository: SQLiteKnowledgeRepository, id: string) {
  repository.decideReview(id, { revision: repository.getReview(id).review.revision, decision: 'ACCEPT', actor: 'Revisor sintético' });
  repository.saveReview(id, metadataFor(repository, id));
  repository.confirmReview(id, repository.getReview(id).review.revision, 'Clasificador sintético');
}
