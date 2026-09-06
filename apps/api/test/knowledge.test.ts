import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KnowledgeGap, Query, ChatResponse } from '@nexa/shared';
import { openDatabase } from '../src/persistence/database.js';
import { PersistenceError, SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { ChatService } from '../src/services/chat.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import { createApp } from '../src/app.js';
import { questionKey } from '../src/domain/questionKey.js';

const provider = new FakeAgentProvider(true);
const question = '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?';
const alias = 'What is the company procedure for decommissioning a printer?';
function fixture(t: TestContext, now?: () => Date) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const repository = new SQLiteKnowledgeRepository(db, now);
  return { db, repository, service: new ChatService(provider, repository) };
}

test('sufficient, unrelated, and failed attempts persist but never create gaps; invalid input is not logged', async (t) => {
  const { service, repository } = fixture(t);
  for (const message of ['¿Que toner utiliza la impresora MX550?', '¿Cuál es la capital de Francia?', 'simular fallo del agente']) {
    const response = await service.chat({ message });
    assert.equal(response.knowledgeGapId, undefined);
    const query = repository.listQueries().find((row) => row.id === response.queryId)!;
    assert.equal(query.assessmentStatus, response.status);
    assert.equal(query.organizationallyRelevant, response.organizationallyRelevant);
    assert.equal(query.knowledgeGapId, null);
  }
  await assert.rejects(service.chat({ message: '' }));
  assert.equal(repository.listQueries().length, 3);
  assert.deepEqual(repository.listGaps(), []);
});

test('session deduplication counts demand once per gap in five minutes while persisting every query', async (t) => {
  let currentTime = new Date('2026-09-06T12:00:00.000Z');
  const { service, repository } = fixture(t, () => currentTime);
  const firstSession = '11111111-1111-4111-8111-111111111111';
  const secondSession = '22222222-2222-4222-8222-222222222222';

  const first = await service.chat({ message: question, clientSessionId: firstSession });
  currentTime = new Date('2026-09-06T12:04:00.000Z');
  const duplicate = await service.chat({ message: alias, clientSessionId: firstSession });
  assert.equal(duplicate.knowledgeGapId, first.knowledgeGapId);
  assert.equal(repository.getGap(first.knowledgeGapId!)?.occurrences, 1);

  currentTime = new Date('2026-09-06T12:04:30.000Z');
  const otherSession = await service.chat({ message: question, clientSessionId: secondSession });
  assert.equal(otherSession.knowledgeGapId, first.knowledgeGapId);
  assert.equal(repository.getGap(first.knowledgeGapId!)?.occurrences, 2);

  currentTime = new Date('2026-09-06T12:05:01.000Z');
  const later = await service.chat({ message: question, clientSessionId: firstSession });
  assert.equal(later.knowledgeGapId, first.knowledgeGapId);
  assert.equal(repository.getGap(first.knowledgeGapId!)?.occurrences, 3);

  const queries = repository.listQueries();
  assert.equal(queries.length, 4);
  assert.deepEqual(queries.map((query) => query.clientSessionId), [firstSession, secondSession, firstSession, firstSession]);
  assert.deepEqual(queries.map((query) => query.countedAsKnowledgeGapOccurrence), [true, true, false, true]);
  assert.ok(queries.every((query) => query.knowledgeGapId === first.knowledgeGapId));
});

test('first insufficient creates DETECTED/MEDIUM; repeats and Spanish/English aliases increment exactly once', async (t) => {
  const { service, repository } = fixture(t);
  const first = await service.chat({ message: question });
  assert.ok(first.knowledgeGapId);
  assert.equal(repository.getGap(first.knowledgeGapId)?.occurrences, 1);
  const repeat = await service.chat({ message: question });
  assert.equal(repeat.knowledgeGapId, first.knowledgeGapId);
  assert.equal(repository.getGap(first.knowledgeGapId)?.occurrences, 2);
  for (const message of [alias, '  ¿COMO se da de baja una impresora???  ']) {
    assert.equal((await service.chat({ message })).knowledgeGapId, first.knowledgeGapId);
  }
  const gaps = repository.listGaps();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.status, 'DETECTED');
  assert.equal(gaps[0]?.priority, 'MEDIUM');
  assert.equal(gaps[0]?.occurrences, 4);
  assert.equal(gaps[0]?.suggestedActions.length, 3);
  assert.ok(repository.listQueries().every((row) => row.knowledgeGapId === first.knowledgeGapId));
  assert.equal(questionKey(question), questionKey(alias));
  assert.notEqual(questionKey(question), questionKey('¿Cómo reparar una impresora?'));
});

test('display titles do not control matching and resolved gaps are not reused', async (t) => {
  const { db, repository, service } = fixture(t);
  const first = await service.chat({ message: question });
  db.prepare('UPDATE knowledge_gaps SET title = ? WHERE id = ?').run('Título revisado', first.knowledgeGapId);
  assert.equal((await service.chat({ message: alias })).knowledgeGapId, first.knowledgeGapId);
  // Seed a future state directly: no transition endpoint is implemented.
  db.prepare("UPDATE knowledge_gaps SET status = 'RESOLVED' WHERE id = ?").run(first.knowledgeGapId);
  const next = await service.chat({ message: question });
  assert.notEqual(next.knowledgeGapId, first.knowledgeGapId);
  assert.equal(repository.getGap(next.knowledgeGapId!)?.occurrences, 1);
});

test('failed query inserts roll back gap creation and occurrence increments', async (t) => {
  const { repository, service } = fixture(t);
  const first = await service.chat({ message: question });
  assert.throws(() => repository.record(question, first, true), PersistenceError);
  assert.equal(repository.getGap(first.knowledgeGapId!)?.occurrences, 1);
  assert.throws(() => repository.record('Otra pregunta organizacional', first, true), PersistenceError);
  assert.equal(repository.listGaps().length, 1);
  assert.equal(repository.listQueries().length, 1);
});

test('incomplete retrieval is a failure, not missing knowledge', async (t) => {
  const { repository } = fixture(t);
  const service = new ChatService({ assessQuestion: async () => ({
    status: 'INSUFFICIENT', organizationallyRelevant: true, retrievalCompleted: false, answer: null, evidence: [],
  }) }, repository);
  assert.equal((await service.chat({ message: question })).status, 'FAILURE');
  assert.equal(repository.listQueries()[0]?.assessmentStatus, 'FAILURE');
  assert.equal(repository.listGaps().length, 0);
});

test('file database survives reopening and initialization is repeatable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexa-db-test-'));
  const path = join(directory, 'isolated.db');
  let db = openDatabase(path);
  try {
    const first = await new ChatService(provider, new SQLiteKnowledgeRepository(db)).chat({ message: question });
    db.close();
    db = openDatabase(path);
    const repository = new SQLiteKnowledgeRepository(db);
    assert.equal(repository.getGap(first.knowledgeGapId!)?.occurrences, 1);
    assert.equal(repository.listQueries()[0]?.id, first.queryId);
    assert.equal(repository.listQueries()[0]?.clientSessionId, null);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true });
  }
});

test('read endpoints expose persisted data, filter status, return 404, and sanitize database failures', async (t) => {
  const { db, repository } = fixture(t);
  const server = createApp(provider, repository).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question }) });
  assert.equal(response.status, 200);
  const chat = await response.json() as ChatResponse;
  const gaps = await (await fetch(`${url}/api/knowledge-gaps`)).json() as { items: KnowledgeGap[] };
  assert.equal(gaps.items[0]?.id, chat.knowledgeGapId);
  const detail = await (await fetch(`${url}/api/knowledge-gaps/${chat.knowledgeGapId}`)).json() as KnowledgeGap;
  assert.equal(detail.occurrences, 1);
  const queries = await (await fetch(`${url}/api/queries`)).json() as { items: Query[] };
  assert.equal(queries.items[0]?.knowledgeGapId, chat.knowledgeGapId);
  assert.equal((await fetch(`${url}/api/knowledge-gaps/missing`)).status, 404);
  assert.equal((await fetch(`${url}/api/knowledge-gaps?status=INVALID`)).status, 400);
  assert.deepEqual(await (await fetch(`${url}/api/knowledge-gaps?status=RESOLVED`)).json(), { items: [] });
  db.exec('DROP TABLE queries');
  const failed = await fetch(`${url}/api/queries`);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: { code: 'PERSISTENCE_ERROR', message: 'No se pudo guardar o leer la información.' } });
});
