import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/persistence/database.js';

function temporaryPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'nexa-migration-')), name);
}

/** Column name, declared type, null flag and default for every table, so both paths can be compared. */
function shape(db: Database.Database): Record<string, string[]> {
  const tables = db.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
  const result: Record<string, string[]> = {};
  for (const { name } of tables) {
    const columns = db.prepare<[], { name: string; type: string; notnull: number; dflt_value: string | null }>(
      `PRAGMA table_info(${name})`,
    ).all();
    result[name] = columns
      .map(column => `${column.name} ${column.type} ${column.notnull} ${column.dflt_value ?? '-'}`)
      .sort();
  }
  return result;
}

test('schema v6 creates the evidence and draft review structures', () => {
  const db = openDatabase(temporaryPath('fresh.db'));
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 6);
    const shapes = shape(db);
    assert.ok(shapes.draft_reviews, 'draft_reviews debe existir');
    assert.ok(shapes.draft_review_comments, 'draft_review_comments debe existir');
    assert.ok(shapes.collected_evidence.some(column => column.startsWith('evidenceType ')));
    assert.ok(shapes.collected_evidence.some(column => column.startsWith('withdrawnAt ')));
    assert.ok(shapes.approvals.some(column => column.startsWith('actor ')));
  } finally {
    db.close();
  }
});

test('a version 5 database upgrades to the same shape as a fresh one', () => {
  const fresh = openDatabase(temporaryPath('fresh.db'));
  const expected = shape(fresh);
  fresh.close();

  // Build a version 5 database by stopping the upgrade there, then reopen it.
  const path = temporaryPath('legacy.db');
  const legacy = openDatabase(path);
  legacy.pragma('user_version = 5');
  legacy.exec('DROP TABLE draft_review_comments; DROP TABLE draft_reviews;');
  for (const column of ['evidenceType', 'contentKind', 'author', 'evidenceDate', 'note', 'url',
    'fileName', 'mimeType', 'sizeBytes', 'meeting', 'version', 'supersededBy',
    'withdrawnAt', 'withdrawnBy', 'withdrawalJustification']) {
    legacy.exec(`ALTER TABLE collected_evidence DROP COLUMN ${column}`);
  }
  legacy.exec('ALTER TABLE approvals DROP COLUMN actor');
  legacy.prepare(`INSERT INTO knowledge_gaps VALUES
    ('gap-1', '¿Pregunta?', 'pregunta', 'Título', 'TI', 'IN_PROGRESS', 'MEDIUM', 1, 1, 'TI', '[]', '[]', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
  legacy.prepare(`INSERT INTO collected_evidence
    (id, knowledgeGapId, content, sourceType, sourceLabel, reference, revision, createdAt)
    VALUES ('ev-1', 'gap-1', 'Texto anterior', 'MANUAL', 'Soporte', NULL, 1, '2026-01-01T00:00:00.000Z')`).run();
  legacy.close();

  const upgraded = openDatabase(path);
  try {
    assert.equal(upgraded.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(shape(upgraded), expected);
    const row = upgraded.prepare<[], { content: string; evidenceType: string; contentKind: string; version: number }>(
      'SELECT content, evidenceType, contentKind, version FROM collected_evidence WHERE id = ?',
    ).get('ev-1');
    assert.deepEqual(row, { content: 'Texto anterior', evidenceType: 'MANUAL_TEXT', contentKind: 'TEXT', version: 1 });
  } finally {
    upgraded.close();
  }
});
