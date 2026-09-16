import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/persistence/database.js';
import { PersistenceError, SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { DomainError } from '../src/domain/workflow.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import { createApp } from '../src/app.js';
import { metadataFor, acceptAndClassify } from './reviewFixture.js';

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => { if (db.open) db.close(); });
  const repository = new SQLiteKnowledgeRepository(db, () => new Date('2026-09-14T12:00:00Z'));
  const create = (message = 'Procedimiento sintético de soporte para impresoras') => repository.record(message, {
    queryId: randomUUID(), answer: 'Información insuficiente.', sufficientKnowledge: false, status: 'INSUFFICIENT',
    organizationallyRelevant: true, evidence: [],
  }, true).knowledgeGapId!;
  return { db, repository, create };
}
const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;

test('human decisions persist reasons and history; inactive requests cannot advance and restoration preserves records', t => {
  const { repository, create } = fixture(t);
  for (const decision of ['DISCARD_NOT_APPLICABLE', 'DISCARD_SENSITIVE', 'DISCARD_IMPROPER'] as const) {
    const id = create('Solicitud sintética ' + decision);
    assert.throws(() => repository.transition(id, { fromStatus: 'DETECTED', toStatus: 'TRIAGED' }), code('APPROVAL_REQUIRED'));
    assert.throws(() => repository.decideReview(id, { revision: 0, decision, actor: 'Revisor' }), code('INVALID_REQUEST'));
    assert.equal(repository.getReview(id).history.length, 0);
    const discarded = repository.decideReview(id, { revision: 0, decision, actor: 'Revisor', reason: 'No corresponde al conocimiento disponible.' });
    assert.equal(discarded.review.disposition, 'DISCARDED');
    assert.equal(discarded.history[0]?.action, decision);
    assert.equal(repository.getGap(id)?.status, 'DETECTED');
    assert.throws(() => repository.triage(id, { priority: 'HIGH' }), code('INVALID_TRANSITION'));
    assert.throws(() => repository.saveReview(id, metadataFor(repository, id)), code('INVALID_TRANSITION'));
    assert.throws(() => repository.decideReview(id, { revision: 1, decision: 'ACCEPT', actor: 'Revisor' }), code('INVALID_TRANSITION'));
    const restored = repository.decideReview(id, { revision: 1, decision: 'RESTORE', actor: 'Otro revisor' });
    assert.equal(restored.review.disposition, 'PENDING');
    assert.equal(restored.history.length, 2);
    assert.equal(repository.getGap(id)?.occurrences, 1);
    assert.equal(repository.listQueries().filter(query => query.knowledgeGapId === id).length, 1);
  }
});

test('classification requires complete assignment, records who and when, invalidates on edits, and can return for fresh review', t => {
  const { repository, create } = fixture(t); const id = create();
  repository.decideReview(id, { revision: 0, decision: 'ACCEPT', actor: 'Ana sintética' });
  assert.equal(repository.getGap(id)?.status, 'TRIAGED');
  assert.throws(() => repository.confirmReview(id, 1, 'Clasificador'), code('INVALID_REQUEST'));
  assert.throws(() => repository.transition(id, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' }), code('APPROVAL_REQUIRED'));
  for (const missing of ['department', 'responsible', 'category'] as const) {
    repository.saveReview(id, { ...metadataFor(repository, id), [missing]: '' });
    assert.throws(() => repository.confirmReview(id, repository.getReview(id).review.revision, 'Clasificador'), code('INVALID_REQUEST'));
  }
  repository.saveReview(id, { ...metadataFor(repository, id), category: 'TI' });
  const confirmed = repository.confirmReview(id, repository.getReview(id).review.revision, 'Luis sintético');
  assert.equal(confirmed.review.classifiedBy, 'Luis sintético');
  assert.equal(confirmed.review.classifiedAt, '2026-09-14T12:00:00.000Z');
  repository.triage(id, { priority: 'LOW' });
  assert.equal(repository.getReview(id).review.classifiedBy, null);
  assert.throws(() => repository.transition(id, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' }), code('APPROVAL_REQUIRED'));
  const beforeReturn = repository.getReview(id).review.revision;
  repository.decideReview(id, { revision: beforeReturn, decision: 'RETURN', actor: 'Luis sintético' });
  assert.equal(repository.getGap(id)?.status, 'DETECTED');
  assert.equal(repository.getReview(id).review.disposition, 'PENDING');
  acceptAndClassify(repository, id);
  repository.transition(id, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' });
  assert.throws(() => repository.decideReview(id, { revision: repository.getReview(id).review.revision, decision: 'RETURN', actor: 'Luis' }), code('INVALID_TRANSITION'));
});

test('duplicate marking validates targets, preserves demand, survives repeated questions and can be restored', t => {
  const { repository, create } = fixture(t); const id = create(); const target = create('Otra brecha de impresoras');
  for (const duplicateOf of [id, 'missing']) assert.throws(() => repository.decideReview(id, { revision: 0, decision: 'DUPLICATE', actor: 'Revisor', duplicateOf }), DomainError);
  repository.decideReview(id, { revision: 0, decision: 'DUPLICATE', actor: 'Revisor', duplicateOf: target });
  assert.throws(() => repository.decideReview(target, { revision: 0, decision: 'DUPLICATE', actor: 'Revisor', duplicateOf: id }), code('INVALID_REQUEST'));
  create();
  assert.equal(repository.getGap(id)?.occurrences, 2);
  assert.equal(repository.getGap(target)?.occurrences, 1);
  assert.equal(repository.getReview(id).review.disposition, 'DUPLICATE');
  repository.decideReview(id, { revision: 1, decision: 'RESTORE', actor: 'Revisor' });
  assert.equal(repository.getReview(id).review.duplicateOf, null);
});

test('metadata links only to existing records; similar suggestions and sensitivity are read-only', t => {
  const { db, repository, create } = fixture(t); const id = create('Procedimiento de consulta salarial individual');
  const target = create('Procedimiento de consulta salarial del equipo');
  const detail = repository.getReview(id);
  assert.equal(detail.sensitiveWarning, true);
  assert.equal(detail.origin, 'Asistente NEXA');
  assert.equal(detail.similarGaps[0]?.id, target);
  assert.equal(detail.review.revision, 0);
  assert.throws(() => repository.saveReview(id, { ...metadataFor(repository, id), relatedGapIds: [id] }), code('INVALID_REQUEST'));
  assert.throws(() => repository.saveReview(id, { ...metadataFor(repository, id), relatedArticleIds: ['missing'] }), code('NOT_FOUND'));
  // Isolated approved-article snapshot. Publication gates are tested in operations.test.ts.
  db.prepare('INSERT INTO approved_knowledge VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('article-demo', target, 1, 'Documento sintético', 'Contenido', 'synthetic-key', 1, '2026-09-14T00:00:00Z');
  const saved = repository.saveReview(id, { ...metadataFor(repository, id), relatedGapIds: [target], relatedArticleIds: ['article-demo'] });
  assert.deepEqual(saved.review.relatedGapIds, [target]);
  assert.deepEqual(saved.review.relatedArticleIds, ['article-demo']);
  assert.equal(repository.getGap(id)?.status, 'DETECTED');
});

test('stale decisions and transaction failures leave state, audit and metadata intact', t => {
  const { db, repository, create } = fixture(t); const id = create();
  repository.saveReview(id, metadataFor(repository, id));
  assert.throws(() => repository.decideReview(id, { revision: 0, decision: 'ACCEPT', actor: 'Revisor' }), code('STALE_STATE'));
  const before = repository.getReview(id); const gap = repository.getGap(id);
  db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON gap_review_events BEGIN SELECT RAISE(ABORT, 'forced'); END;");
  assert.throws(() => repository.decideReview(id, { revision: 1, decision: 'ACCEPT', actor: 'Revisor' }), PersistenceError);
  assert.deepEqual(repository.getReview(id), before); assert.deepEqual(repository.getGap(id), gap);
  db.exec('DROP TRIGGER fail_review');
  db.exec("CREATE TRIGGER fail_review_save BEFORE UPDATE ON gap_reviews BEGIN SELECT RAISE(ABORT, 'forced'); END;");
  assert.throws(() => repository.saveReview(id, { ...metadataFor(repository, id), title: 'Cambio que falla' }), PersistenceError);
  assert.deepEqual(repository.getGap(id), gap); assert.deepEqual(repository.getReview(id), before);
});

test('review list filters and paginates in the backend with stable boundaries and inclusive dates', t => {
  const { repository, create } = fixture(t);
  for (let i = 0; i < 13; i++) { const id = create('Solicitud sintética ' + i); repository.saveReview(id, metadataFor(repository, id)); }
  const all = repository.listReviews({ page: 1, pageSize: 10 });
  assert.equal(all.total, 13); assert.equal(all.items.length, 10);
  const rest = repository.listReviews({ page: 2, pageSize: 10 });
  assert.equal(rest.items.length, 3); assert.equal(new Set([...all.items, ...rest.items].map(item => item.id)).size, 13);
  const id = all.items[0]!.id;
  repository.decideReview(id, { revision: 1, decision: 'DISCARD_SENSITIVE', actor: 'Revisor', reason: 'Información sensible sintética' });
  assert.equal(repository.listReviews({ page: 1, pageSize: 10, disposition: 'DISCARDED' }).total, 1);
  assert.equal(repository.listReviews({ page: 1, pageSize: 10, disposition: 'PENDING', department: 'Soporte TI', priority: 'MEDIUM', status: 'DETECTED', from: '2026-09-14', to: '2026-09-14' }).total, 12);
  assert.equal(repository.listReviews({ page: 1, pageSize: 10, q: 'SOLICITUD' }).total, 13);
  assert.equal(repository.listReviews({ page: 1, pageSize: 10, q: "' OR 1=1 --" }).total, 0);
  assert.equal(repository.listReviews({ page: 1, pageSize: 10, to: '2026-09-13' }).total, 0);
});

test('HTTP review validates actors, dates, filters, stale edits and exposes safe storage failures', async t => {
  const { db, repository, create } = fixture(t); const id = create();
  const server = createApp(new FakeAgentProvider(true), repository).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening'); const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
  const post = (path: string, body: object, method = 'POST') => fetch(base + '/knowledge-gaps/' + id + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const query of ['page=0', 'pageSize=101', 'page=1.5', 'status=BAD', 'disposition=BAD', 'from=2026-02-30', 'from=2026-09-15&to=2026-09-14', 'q[x]=foo']) assert.equal((await fetch(base + '/knowledge-reviews?' + query)).status, 400);
  assert.equal((await post('/review/decision', { revision: 0, decision: 'ACCEPT', actor: '' })).status, 400);
  assert.equal((await post('/review', { ...metadataFor(repository, id), targetDate: '2026-02-30' }, 'PATCH')).status, 400);
  assert.equal((await post('/review/decision', { revision: 0, decision: 'ACCEPT', actor: 'Ana', admin: true })).status, 400);
  assert.equal((await post('/review/decision', { revision: 0, decision: 'ACCEPT', actor: 'Ana' })).status, 200);
  assert.equal((await post('/review/decision', { revision: 0, decision: 'RETURN', actor: 'Ana' })).status, 409);
  assert.equal((await post('/review/classify', { revision: 1, actor: 'Ana' })).status, 400);
  assert.equal((await post('/review', metadataFor(repository, id), 'PATCH')).status, 200);
  assert.equal((await post('/review/classify', { revision: 2, actor: 'Ana' })).status, 200);
  assert.equal((await fetch(base + '/knowledge-gaps/missing/review')).status, 404);
  db.close();
  const failed = await fetch(base + '/knowledge-reviews'); assert.equal(failed.status, 500);
  assert.equal(((await failed.json()) as { error: { code: string } }).error.code, 'PERSISTENCE_ERROR');
});

test('legacy TRIAGED gaps require classification without inventing reviewer identity', t => {
  const { db, repository, create } = fixture(t); const id = create();
  // A current store can be reopened repeatedly; a pre-migration snapshot has no review rows.
  assert.equal(db.pragma('user_version', { simple: true }), 5);
  db.prepare("UPDATE knowledge_gaps SET status = 'TRIAGED' WHERE id = ?").run(id);
  assert.equal(repository.getReview(id).review.disposition, 'ACCEPTED');
  assert.equal(repository.getReview(id).review.classifiedBy, null);
  assert.throws(() => repository.transition(id, { fromStatus: 'TRIAGED', toStatus: 'ACTION_PROPOSED' }), code('APPROVAL_REQUIRED'));
  repository.saveReview(id, metadataFor(repository, id));
  repository.confirmReview(id, 1, 'Revisor sintético');
  assert.equal(repository.getGap(id)?.status, 'TRIAGED');
});

test('schema v3 migrates non-destructively and reopens with persistent review history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexa-review-migration-'));
  const path = join(directory, 'migration.db');
  let db = openDatabase(path);
  try {
    const repository = new SQLiteKnowledgeRepository(db);
    const id = repository.record('Pregunta sintética para migración', { queryId: randomUUID(), answer: 'Sin información', sufficientKnowledge: false,
      status: 'INSUFFICIENT', organizationallyRelevant: true, evidence: [] }, true).knowledgeGapId!;
    const before = repository.getGap(id);
    db.exec('DROP TABLE gap_review_events; DROP TABLE gap_reviews; PRAGMA user_version = 3;');
    db.close(); db = openDatabase(path);
    let migrated = new SQLiteKnowledgeRepository(db);
    assert.equal(db.pragma('user_version', { simple: true }), 5);
    assert.deepEqual(migrated.getGap(id), before);
    assert.equal(migrated.getReview(id).review.revision, 0);
    migrated.decideReview(id, { revision: 0, actor: 'Revisor sintético', decision: 'DISCARD_NOT_APPLICABLE', reason: 'Fuera de alcance' });
    db.close(); db = openDatabase(path); migrated = new SQLiteKnowledgeRepository(db);
    assert.equal(migrated.getReview(id).review.disposition, 'DISCARDED');
    assert.equal(migrated.getReview(id).history[0]?.reason, 'Fuera de alcance');
    assert.equal(migrated.listQueries().length, 1);
  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('schema v4 from either branch migrates missing review or activity tables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexa-v4-collision-'));
  const path = join(directory, 'collision.db');
  let db = openDatabase(path);
  try {
    const id = new SQLiteKnowledgeRepository(db).record('Pregunta sintética para colisión v4', { queryId: randomUUID(), answer: 'Sin información', sufficientKnowledge: false,
      status: 'INSUFFICIENT', organizationallyRelevant: true, evidence: [] }, true).knowledgeGapId!;
    db.exec('DROP TABLE gap_review_events; DROP TABLE gap_reviews; PRAGMA user_version = 4;');
    db.close(); db = openDatabase(path);
    assert.equal(db.pragma('user_version', { simple: true }), 5);
    assert.equal(new SQLiteKnowledgeRepository(db).getReview(id).review.revision, 0);
    db.exec('DROP TABLE recovery_activity; PRAGMA user_version = 4;');
    db.close(); db = openDatabase(path);
    assert.equal(db.pragma('user_version', { simple: true }), 5);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('recovery_activity', 'gap_reviews') ORDER BY name")
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables.map(row => row.name), ['gap_reviews', 'recovery_activity']);
    assert.equal(new SQLiteKnowledgeRepository(db).getReview(id).review.revision, 0);
  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
});
