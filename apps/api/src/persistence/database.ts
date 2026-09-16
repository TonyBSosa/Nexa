import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * ALTER TABLE ADD COLUMN is not idempotent, and a database can reach an upgrade
 * block already carrying some columns. Only the missing ones are added.
 */
function addMissingColumns(db: Database.Database, table: string, columns: Record<string, string>): string {
  const existing = new Set(db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().map(column => column.name));
  return Object.entries(columns)
    .filter(([name]) => !existing.has(name))
    .map(([name, definition]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`)
    .join('\n');
}

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true });
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) {
      throw new Error('Unsupported database schema version.');
    }
    if (version === 0) db.transaction(() => {
      db.exec(`
        CREATE TABLE knowledge_gaps (
          id TEXT PRIMARY KEY,
          originalQuestion TEXT NOT NULL,
          normalizedQuestionKey TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT,
          status TEXT NOT NULL CHECK (status IN ('DETECTED','TRIAGED','ACTION_PROPOSED','IN_PROGRESS','KNOWLEDGE_COLLECTED','AWAITING_APPROVAL','PUBLISHED','RESOLVED')),
          priority TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH')),
          occurrences INTEGER NOT NULL CHECK (occurrences >= 1),
          evidenceRevision INTEGER NOT NULL DEFAULT 0 CHECK (evidenceRevision >= 0),
          suggestedDepartment TEXT,
          suggestedExperts TEXT NOT NULL,
          suggestedActions TEXT NOT NULL,
          selectedAction TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX one_open_gap_per_key ON knowledge_gaps(normalizedQuestionKey) WHERE status <> 'RESOLVED';
        CREATE TABLE queries (
          id TEXT PRIMARY KEY,
          message TEXT NOT NULL,
          clientSessionId TEXT,
          normalizedQuestionKey TEXT,
          assessmentStatus TEXT NOT NULL CHECK (assessmentStatus IN ('SUFFICIENT','INSUFFICIENT','FAILURE')),
          organizationallyRelevant INTEGER CHECK (organizationallyRelevant IN (0,1)),
          sufficientKnowledge INTEGER NOT NULL CHECK (sufficientKnowledge IN (0,1)),
          answer TEXT,
          category TEXT,
          evidence TEXT NOT NULL,
          knowledgeGapId TEXT REFERENCES knowledge_gaps(id),
          countedAsKnowledgeGapOccurrence INTEGER NOT NULL CHECK (countedAsKnowledgeGapOccurrence IN (0,1)),
          createdAt TEXT NOT NULL
        );
        CREATE INDEX queries_by_gap ON queries(knowledgeGapId);
        CREATE INDEX queries_by_session_gap_time ON queries(clientSessionId, knowledgeGapId, createdAt);
        CREATE TABLE collected_evidence (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          content TEXT NOT NULL,
          sourceType TEXT NOT NULL CHECK (sourceType = 'MANUAL'),
          sourceLabel TEXT NOT NULL,
          reference TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          createdAt TEXT NOT NULL,
          evidenceType TEXT,
          contentKind TEXT,
          author TEXT,
          evidenceDate TEXT,
          note TEXT,
          url TEXT,
          fileName TEXT,
          mimeType TEXT,
          sizeBytes INTEGER,
          meeting TEXT,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          supersededBy TEXT,
          withdrawnAt TEXT,
          withdrawnBy TEXT,
          withdrawalJustification TEXT,
          UNIQUE (knowledgeGapId, revision)
        );
        CREATE TABLE knowledge_drafts (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision > 0),
          evidenceRevisionUsed INTEGER NOT NULL CHECK (evidenceRevisionUsed > 0),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          UNIQUE (knowledgeGapId, revision)
        );
        CREATE TABLE approvals (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          decision TEXT NOT NULL CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
          draftRevision INTEGER NOT NULL CHECK (draftRevision > 0),
          comment TEXT,
          createdAt TEXT NOT NULL,
          actor TEXT,
          UNIQUE (knowledgeGapId, draftRevision)
        );
        CREATE TABLE approved_knowledge (
          articleId TEXT PRIMARY KEY,
          sourceKnowledgeGapId TEXT NOT NULL UNIQUE REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision > 0),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          normalizedQuestionKey TEXT NOT NULL UNIQUE,
          approvedDraftRevision INTEGER NOT NULL CHECK (approvedDraftRevision > 0),
          publishedAt TEXT NOT NULL
        );
        CREATE TABLE recovery_activity (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX recovery_activity_by_gap ON recovery_activity(knowledgeGapId, createdAt);
        CREATE TABLE gap_reviews (
          knowledgeGapId TEXT PRIMARY KEY REFERENCES knowledge_gaps(id),
          data TEXT NOT NULL CHECK (json_valid(data))
        );
        CREATE TABLE gap_review_events (
          id INTEGER PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT,
          snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
          createdAt TEXT NOT NULL
        );
        CREATE INDEX review_events_by_gap ON gap_review_events(knowledgeGapId, id);
        CREATE TABLE IF NOT EXISTS draft_reviews (
          knowledgeGapId TEXT PRIMARY KEY REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          submittedBy TEXT,
          submittedAt TEXT,
          revisionUnderReview INTEGER CHECK (revisionUnderReview > 0),
          assignedReviewers TEXT NOT NULL CHECK (json_valid(assignedReviewers)),
          confirmations TEXT NOT NULL CHECK (json_valid(confirmations))
        );
        CREATE TABLE IF NOT EXISTS draft_review_comments (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          draftRevision INTEGER NOT NULL CHECK (draftRevision > 0),
          actor TEXT NOT NULL,
          startLine INTEGER,
          endLine INTEGER,
          quote TEXT,
          body TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS draft_comments_by_gap ON draft_review_comments(knowledgeGapId, draftRevision, id);
        PRAGMA user_version = 6;
      `);
    })();
    if (version === 1) db.transaction(() => {
      db.exec(`
        ALTER TABLE queries ADD COLUMN clientSessionId TEXT;
        ALTER TABLE queries ADD COLUMN countedAsKnowledgeGapOccurrence INTEGER NOT NULL DEFAULT 0 CHECK (countedAsKnowledgeGapOccurrence IN (0,1));
        CREATE INDEX queries_by_session_gap_time ON queries(clientSessionId, knowledgeGapId, createdAt);
        PRAGMA user_version = 2;
      `);
    })();
    if (version === 1 || version === 2) db.transaction(() => {
      db.exec(`
        ALTER TABLE knowledge_gaps ADD COLUMN evidenceRevision INTEGER NOT NULL DEFAULT 0 CHECK (evidenceRevision >= 0);
        ALTER TABLE knowledge_gaps ADD COLUMN selectedAction TEXT;
        CREATE TABLE collected_evidence (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          content TEXT NOT NULL,
          sourceType TEXT NOT NULL CHECK (sourceType = 'MANUAL'),
          sourceLabel TEXT NOT NULL,
          reference TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          createdAt TEXT NOT NULL,
          UNIQUE (knowledgeGapId, revision)
        );
        CREATE TABLE knowledge_drafts (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision > 0),
          evidenceRevisionUsed INTEGER NOT NULL CHECK (evidenceRevisionUsed > 0),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          UNIQUE (knowledgeGapId, revision)
        );
        CREATE TABLE approvals (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          decision TEXT NOT NULL CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
          draftRevision INTEGER NOT NULL CHECK (draftRevision > 0),
          comment TEXT,
          createdAt TEXT NOT NULL,
          UNIQUE (knowledgeGapId, draftRevision)
        );
        CREATE TABLE approved_knowledge (
          articleId TEXT PRIMARY KEY,
          sourceKnowledgeGapId TEXT NOT NULL UNIQUE REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision > 0),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          normalizedQuestionKey TEXT NOT NULL UNIQUE,
          approvedDraftRevision INTEGER NOT NULL CHECK (approvedDraftRevision > 0),
          publishedAt TEXT NOT NULL
        );
        PRAGMA user_version = 3;
      `);
    })();
    if (version === 1 || version === 2 || version === 3 || version === 4) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recovery_activity (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS recovery_activity_by_gap ON recovery_activity(knowledgeGapId, createdAt);
        CREATE TABLE IF NOT EXISTS gap_reviews (
          knowledgeGapId TEXT PRIMARY KEY REFERENCES knowledge_gaps(id),
          data TEXT NOT NULL CHECK (json_valid(data))
        );
        CREATE TABLE IF NOT EXISTS gap_review_events (
          id INTEGER PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT,
          snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS review_events_by_gap ON gap_review_events(knowledgeGapId, id);
        PRAGMA user_version = 5;
      `);
    })();
    if (version >= 1 && version <= 5) db.transaction(() => {
      const evidenceColumns = addMissingColumns(db, 'collected_evidence', {
        evidenceType: 'TEXT', contentKind: 'TEXT', author: 'TEXT', evidenceDate: 'TEXT', note: 'TEXT',
        url: 'TEXT', fileName: 'TEXT', mimeType: 'TEXT', sizeBytes: 'INTEGER', meeting: 'TEXT',
        version: 'INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)', supersededBy: 'TEXT',
        withdrawnAt: 'TEXT', withdrawnBy: 'TEXT', withdrawalJustification: 'TEXT',
      });
      const approvalColumns = addMissingColumns(db, 'approvals', { actor: 'TEXT' });
      db.exec(`
        ${evidenceColumns}
        ${approvalColumns}
        UPDATE collected_evidence SET evidenceType = 'MANUAL_TEXT', contentKind = 'TEXT' WHERE evidenceType IS NULL;
        CREATE TABLE IF NOT EXISTS draft_reviews (
          knowledgeGapId TEXT PRIMARY KEY REFERENCES knowledge_gaps(id),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          submittedBy TEXT,
          submittedAt TEXT,
          revisionUnderReview INTEGER CHECK (revisionUnderReview > 0),
          assignedReviewers TEXT NOT NULL CHECK (json_valid(assignedReviewers)),
          confirmations TEXT NOT NULL CHECK (json_valid(confirmations))
        );
        CREATE TABLE IF NOT EXISTS draft_review_comments (
          id TEXT PRIMARY KEY,
          knowledgeGapId TEXT NOT NULL REFERENCES knowledge_gaps(id),
          draftRevision INTEGER NOT NULL CHECK (draftRevision > 0),
          actor TEXT NOT NULL,
          startLine INTEGER,
          endLine INTEGER,
          quote TEXT,
          body TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS draft_comments_by_gap ON draft_review_comments(knowledgeGapId, draftRevision, id);
        PRAGMA user_version = 6;
      `);
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
