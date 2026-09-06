import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ChatResponse, KnowledgeGap, KnowledgeGapStatus, Query } from '@nexa/shared';
import { questionKey } from '../domain/questionKey.js';

export class PersistenceError extends Error {
  constructor() { super('No se pudo guardar o leer la información.'); }
}

export interface KnowledgeRepository {
  record(message: string, response: ChatResponse, gapEligible: boolean, clientSessionId?: string): Query;
  listQueries(): Query[];
  listGaps(status?: KnowledgeGapStatus): KnowledgeGap[];
  getGap(id: string): KnowledgeGap | undefined;
}

type GapRow = Omit<KnowledgeGap, 'suggestedExperts' | 'suggestedActions'> & { suggestedExperts: string; suggestedActions: string };
type QueryRow = Omit<Query, 'organizationallyRelevant' | 'sufficientKnowledge' | 'countedAsKnowledgeGapOccurrence' | 'evidence'> & {
  organizationallyRelevant: number | null;
  sufficientKnowledge: number;
  countedAsKnowledgeGapOccurrence: number;
  evidence: string;
};

function gapFromRow(row: GapRow): KnowledgeGap {
  return { ...row, suggestedExperts: JSON.parse(row.suggestedExperts), suggestedActions: JSON.parse(row.suggestedActions) };
}

export class SQLiteKnowledgeRepository implements KnowledgeRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private guard<T>(operation: () => T): T {
    try { return operation(); } catch { throw new PersistenceError(); }
  }

  record(message: string, response: ChatResponse, gapEligible: boolean, clientSessionId?: string): Query {
    return this.guard(() => this.db.transaction(() => {
      const now = this.now();
      const createdAt = now.toISOString();
      const key = response.organizationallyRelevant === true ? questionKey(message) : null;
      let gapId: string | null = null;
      let countedAsKnowledgeGapOccurrence = false;
      if (gapEligible && response.status === 'INSUFFICIENT' && response.organizationallyRelevant === true && key) {
        const existing = this.db.prepare<[string], { id: string }>("SELECT id FROM knowledge_gaps WHERE normalizedQuestionKey = ? AND status <> 'RESOLVED'").get(key);
        gapId = existing?.id ?? randomUUID();
        if (existing) {
          const duplicateInWindow = clientSessionId !== undefined && this.db.prepare<[string, string, string], { found: number }>(`
            SELECT 1 AS found FROM queries
            WHERE clientSessionId = ? AND knowledgeGapId = ?
              AND countedAsKnowledgeGapOccurrence = 1 AND createdAt > ?
            LIMIT 1
          `).get(clientSessionId, gapId, new Date(now.getTime() - 5 * 60_000).toISOString()) !== undefined;
          if (!duplicateInWindow) {
            this.db.prepare('UPDATE knowledge_gaps SET occurrences = occurrences + 1, updatedAt = ? WHERE id = ?').run(createdAt, gapId);
            countedAsKnowledgeGapOccurrence = true;
          }
        } else {
          countedAsKnowledgeGapOccurrence = true;
          this.db.prepare(`INSERT INTO knowledge_gaps
            (id, originalQuestion, normalizedQuestionKey, title, category, status, priority, occurrences, suggestedDepartment, suggestedExperts, suggestedActions, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, 'DETECTED', 'MEDIUM', 1, ?, ?, ?, ?, ?)`)
            .run(gapId, message, key, message, response.suggestedCategory ?? null,
              response.suggestedDepartment ?? null, JSON.stringify(response.suggestedExperts ?? []),
              JSON.stringify(response.suggestedActions?.length ? response.suggestedActions : [{ type: 'REQUEST_INFORMATION', description: 'Solicitar información para documentar el procedimiento faltante (propuesta de respaldo).' }]), createdAt, createdAt);
        }
      }
      const query: Query = {
        id: response.queryId, message, clientSessionId: clientSessionId ?? null, normalizedQuestionKey: key,
        assessmentStatus: response.status, organizationallyRelevant: response.organizationallyRelevant,
        sufficientKnowledge: response.sufficientKnowledge, answer: response.answer,
        category: response.suggestedCategory ?? null, evidence: response.evidence,
        knowledgeGapId: gapId, countedAsKnowledgeGapOccurrence, createdAt,
      };
      this.db.prepare(`INSERT INTO queries
        (id, message, clientSessionId, normalizedQuestionKey, assessmentStatus, organizationallyRelevant, sufficientKnowledge, answer, category, evidence, knowledgeGapId, countedAsKnowledgeGapOccurrence, createdAt)
        VALUES (@id, @message, @clientSessionId, @normalizedQuestionKey, @assessmentStatus, @organizationallyRelevant, @sufficientKnowledge, @answer, @category, @evidence, @knowledgeGapId, @countedAsKnowledgeGapOccurrence, @createdAt)`)
        .run({
          ...query,
          organizationallyRelevant: query.organizationallyRelevant === null ? null : Number(query.organizationallyRelevant),
          sufficientKnowledge: Number(query.sufficientKnowledge),
          countedAsKnowledgeGapOccurrence: Number(query.countedAsKnowledgeGapOccurrence),
          evidence: JSON.stringify(query.evidence),
        });
      return query;
    }).immediate());
  }

  listQueries(): Query[] {
    return this.guard(() => this.db.prepare<[], QueryRow>('SELECT * FROM queries ORDER BY createdAt DESC, rowid DESC').all().map((row) => ({
      ...row, organizationallyRelevant: row.organizationallyRelevant === null ? null : Boolean(row.organizationallyRelevant),
      sufficientKnowledge: Boolean(row.sufficientKnowledge),
      countedAsKnowledgeGapOccurrence: Boolean(row.countedAsKnowledgeGapOccurrence), evidence: JSON.parse(row.evidence),
    })));
  }

  listGaps(status?: KnowledgeGapStatus): KnowledgeGap[] {
    return this.guard(() => (status
      ? this.db.prepare<[string], GapRow>('SELECT * FROM knowledge_gaps WHERE status = ? ORDER BY updatedAt DESC, rowid DESC').all(status)
      : this.db.prepare<[], GapRow>('SELECT * FROM knowledge_gaps ORDER BY updatedAt DESC, rowid DESC').all()).map(gapFromRow));
  }

  getGap(id: string): KnowledgeGap | undefined {
    return this.guard(() => {
      const row = this.db.prepare<[string], GapRow>('SELECT * FROM knowledge_gaps WHERE id = ?').get(id);
      return row ? gapFromRow(row) : undefined;
    });
  }
}
