import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true });
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error('Unsupported database schema version.');
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
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
