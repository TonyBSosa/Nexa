import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { AnalyticsSummary } from '@nexa/shared';
import { openDatabase } from '../src/persistence/database.js';
import { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import { ChatService } from '../src/services/chat.js';
import { getAnalytics } from '../src/services/analytics.js';
import { createApp } from '../src/app.js';

function fixture(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => { if (db.open) db.close(); });
  const repository = new SQLiteKnowledgeRepository(db);
  const provider = new FakeAgentProvider(true);
  return { db, repository, provider, service: new ChatService(provider, repository) };
}
const question = '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?';

test('empty analytics has real zeros, all states, empty lists and undefined rates', t => {
  const { repository } = fixture(t);
  const result = getAnalytics(repository);
  for (const field of ['totalAttempts', 'totalQueries', 'organizationalQueries', 'answeredQueries', 'insufficientQueries', 'openGaps', 'resolvedGaps', 'inRecoveryGaps', 'publishedKnowledge', 'totalGapOccurrences'] as const) assert.equal(result[field], 0);
  assert.equal(result.queryAnswerRate, null);
  assert.equal(result.gapResolutionRate, null);
  assert.equal(Object.keys(result.gapsByStatus).length, 8);
  assert.ok(Object.values(result.gapsByStatus).every(count => count === 0));
  for (const field of ['recentActivity', 'frequentOpenGaps', 'categories', 'sourceUsage'] as const) assert.deepEqual(result[field], []);
});

test('organizational metrics exclude failures and unrelated input; session repeats retain outcomes without extra demand', async t => {
  const { repository, service, db } = fixture(t);
  for (const message of ['¿Que toner utiliza la impresora MX550?', '¿Cuál es la capital de Francia?', 'simular fallo del agente']) await service.chat({ message });
  const clientSessionId = '11111111-1111-4111-8111-111111111111';
  await service.chat({ message: question, clientSessionId });
  await service.chat({ message: question, clientSessionId });
  await service.chat({ message: question });
  // Repeated source references in one query count only once; unknown categories remain visible.
  db.prepare("UPDATE queries SET category = NULL, evidence = ? WHERE assessmentStatus = 'SUFFICIENT'")
    .run(JSON.stringify([{ sourceId: 'synthetic', title: 'A' }, { sourceId: 'synthetic', title: 'B' }]));
  const result = getAnalytics(repository);
  assert.equal(result.totalAttempts, 6);
  assert.equal(result.totalQueries, 4);
  assert.equal(result.organizationalQueries, 4);
  assert.equal(result.answeredQueries, 1);
  assert.equal(result.insufficientQueries, 3);
  assert.equal(result.queryAnswerRate, 0.25);
  assert.equal(result.openGaps, 1);
  assert.equal(result.totalGapOccurrences, 2);
  assert.equal(result.frequentOpenGaps[0]?.occurrences, 2);
  assert.equal(result.recentActivity.length, 4);
  assert.ok(result.recentActivity.every(query => query.organizationallyRelevant && query.assessmentStatus !== 'FAILURE'));
  assert.equal(result.categories.reduce((sum, row) => sum + row.count, 0), 4);
  assert.ok(result.categories.some(row => row.category === 'Unclassified' && row.count === 1));
  assert.deepEqual(result.sourceUsage, [{ sourceId: 'synthetic', queryCount: 1 }]);
});

test('stored publication and resolution counts are distinct and do not rewrite historical outcomes', async t => {
  const { db, service, repository } = fixture(t);
  await service.chat({ message: question });
  await service.chat({ message: question });
  const gap = repository.listGaps()[0]!;
  // Isolated aggregation snapshot; workflow gates are covered by operations.test.ts.
  db.prepare("UPDATE knowledge_gaps SET status = 'PUBLISHED' WHERE id = ?").run(gap.id);
  db.prepare('INSERT INTO approved_knowledge VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('article-demo', gap.id, 1, 'Synthetic procedure', 'Synthetic approved evidence', gap.normalizedQuestionKey, 1, '2026-09-08T12:00:00Z');
  let result = getAnalytics(repository);
  assert.equal(result.openGaps, 1);
  assert.equal(result.resolvedGaps, 0);
  assert.equal(result.publishedKnowledge, 1);
  assert.equal(result.gapsByStatus.PUBLISHED, 1);
  assert.equal(result.frequentOpenGaps.length, 1);
  db.prepare("UPDATE knowledge_gaps SET status = 'RESOLVED' WHERE id = ?").run(gap.id);
  result = getAnalytics(repository);
  assert.equal(result.openGaps, 0);
  assert.equal(result.resolvedGaps, 1);
  assert.equal(result.publishedKnowledge, 1);
  assert.equal(result.gapResolutionRate, 1);
  assert.equal(result.insufficientQueries, 2);
  assert.equal(result.totalGapOccurrences, 2);
  assert.deepEqual(result.frequentOpenGaps, []);
});

test('frequent gaps use descending counted demand, exclude single occurrences and resolved gaps, and limit to five', async t => {
  const { db, service, repository } = fixture(t);
  await service.chat({ message: question });
  const original = repository.listGaps()[0]!;
  const insert = db.prepare(
    'INSERT INTO knowledge_gaps SELECT ?, originalQuestion, ?, ?, category, ?, priority, ?, evidenceRevision, suggestedDepartment, suggestedExperts, suggestedActions, selectedAction, createdAt, updatedAt FROM knowledge_gaps WHERE id = ?'
  );
  for (let i = 2; i <= 8; i++) insert.run('gap-' + i, 'key-' + i, 'Synthetic ' + i, 'IN_PROGRESS', i, original.id);
  insert.run('resolved', 'resolved', 'Synthetic resolved', 'RESOLVED', 99, original.id);
  const result = getAnalytics(repository);
  assert.deepEqual(result.frequentOpenGaps.map(gap => gap.occurrences), [8, 7, 6, 5, 4]);
  assert.equal(result.inRecoveryGaps, 7);
  assert.equal(result.openGaps, 8);
});

test('both HTTP summaries reflect SQLite and sanitize persistence failures', async t => {
  const { db, repository, provider, service } = fixture(t);
  await service.chat({ message: question });
  const server = createApp(provider, repository).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  for (const path of ['/api/dashboard', '/api/analytics']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const body = await response.json() as AnalyticsSummary;
    assert.deepEqual(body, getAnalytics(repository));
    assert.equal(body.insufficientQueries, 1);
  }
  db.close();
  for (const path of ['/api/dashboard', '/api/analytics']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'PERSISTENCE_ERROR', message: 'No se pudo guardar o leer la información.' } });
  }
});
