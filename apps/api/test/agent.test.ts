import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import { ChatService, InvalidChatRequest } from '../src/services/chat.js';
import { createApp } from '../src/app.js';
import type { AgentProvider } from '../src/integrations/agent/AgentProvider.js';
import type { ChatResponse } from '@nexa/shared';
import { openDatabase } from '../src/persistence/database.js';
import { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';

const provider = new FakeAgentProvider(true);
const sufficient = '¿Qué tóner utiliza la impresora MX550?';
const insufficient = '¿Cuál es el procedimiento de la empresa para dar de baja una impresora?';

test('fake sufficient fixtures are synthetic, evidenced, and deterministic in both languages', async () => {
  const expected = await provider.assessQuestion({ question: sufficient });
  assert.equal(expected.status, 'SUFFICIENT');
  assert.equal(expected.organizationallyRelevant, true);
  assert.match(expected.answer ?? '', /Datos sintéticos.*NX-550 Black/);
  assert.equal(expected.evidence.length, 1);
  for (const question of ['  ¿QUÉ TÓNER usa la impresora MX550?  ', 'What toner does the MX550 printer use?', sufficient]) {
    assert.deepEqual(await provider.assessQuestion({ question }), expected);
  }
});

test('undocumented retirement has no answer and offers only recovery proposals', async () => {
  for (const question of [insufficient, '¿Cómo se da de baja una impresora?', 'What is the company procedure for retiring a printer?']) {
    const result = await provider.assessQuestion({ question });
    assert.equal(result.status, 'INSUFFICIENT');
    if (result.status !== 'INSUFFICIENT') throw new Error('Expected insufficient');
    assert.equal(result.organizationallyRelevant, true);
    assert.equal(result.answer, null);
    assert.equal(result.suggestedDepartment, 'Soporte de TI');
    assert.deepEqual(result.suggestedActions?.map((action) => action.type), ['REQUEST_INFORMATION', 'REQUEST_DOCUMENT', 'PROPOSE_MEETING']);
  }
});

test('unrelated, greetings, unsupported questions, and near matches never fabricate toner facts', async () => {
  for (const question of ['¿Cuál es la capital de Francia?', 'What is the capital of France?', 'hola', 'hello', 'What toner does the MX551 printer use?', 'What is the price of MX550 toner?']) {
    const result = await provider.assessQuestion({ question });
    assert.equal(result.organizationallyRelevant, false);
    assert.equal(result.answer, null);
    assert.deepEqual(result.evidence, []);
  }
});

test('explicit failure is controlled and only enabled by development wiring', async () => {
  const result = await provider.assessQuestion({ question: 'simular fallo del agente' });
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.retrievalCompleted, false);
  assert.equal(result.organizationallyRelevant, null);
  assert.deepEqual(await provider.assessQuestion({ question: 'simulate agent failure' }), result);
  assert.notEqual((await new FakeAgentProvider().assessQuestion({ question: 'simulate agent failure' })).status, 'FAILURE');
  assert.notEqual((await new FakeAgentProvider().assessQuestion({ question: 'simular fallo del agente' })).status, 'FAILURE');
});

test('service preserves result distinctions and persists unique IDs with eligible gaps only', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const service = new ChatService(provider, new SQLiteKnowledgeRepository(db));
  const ids = new Set<string>();
  for (const [message, status, relevance] of [
    [sufficient, 'SUFFICIENT', true], [insufficient, 'INSUFFICIENT', true],
    ['¿Cuál es la capital de Francia?', 'INSUFFICIENT', false], ['simular fallo del agente', 'FAILURE', null],
  ] as const) {
    const response = await service.chat({ message });
    assert.equal(response.status, status);
    assert.equal(response.organizationallyRelevant, relevance);
    assert.equal(response.sufficientKnowledge, status === 'SUFFICIENT');
    assert.equal('knowledgeGapId' in response, status === 'INSUFFICIENT' && relevance === true);
    assert.match(response.queryId, /^[0-9a-f-]{36}$/);
    ids.add(response.queryId);
  }
  assert.equal(ids.size, 4);
});

test('service validates requests before invoking provider and sanitizes thrown failures', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let calls = 0;
  const throwing: AgentProvider = {
    assessQuestion: async () => { calls++; throw new Error('private provider detail'); },
    generateKnowledgeDraft: async () => { throw new Error('not used'); },
  };
  const service = new ChatService(throwing, new SQLiteKnowledgeRepository(db));
  for (const input of [null, {}, [], { message: '' }, { message: '  ' }, { message: 7 }, { question: sufficient }, { message: sufficient, extra: true }, { message: sufficient, clientSessionId: 'invalid' }]) {
    await assert.rejects(service.chat(input), InvalidChatRequest);
  }
  assert.equal(calls, 0);
  const response = await service.chat({ message: sufficient });
  assert.equal(response.status, 'FAILURE');
  assert.equal(response.error?.code, 'AGENT_UNAVAILABLE');
  assert.equal(JSON.stringify(response).includes('private provider detail'), false);
});

test('HTTP contract: health, structured outcomes, validation, malformed JSON, and failure', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const server = createApp(provider, new SQLiteKnowledgeRepository(db)).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'nexa-api' });
  for (const [message, expectedStatus, assessmentStatus] of [
    [sufficient, 200, 'SUFFICIENT'], [insufficient, 200, 'INSUFFICIENT'],
    ['¿Cuál es la capital de Francia?', 200, 'INSUFFICIENT'], ['simular fallo del agente', 503, 'FAILURE'],
  ] as const) {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    assert.equal(response.status, expectedStatus);
    const body = await response.json() as ChatResponse;
    assert.equal(body.status, assessmentStatus);
    assert.equal(typeof body.queryId, 'string');
    assert.equal('knowledgeGapId' in body, message === insufficient);
    assert.ok(Array.isArray(body.evidence));
    if (message === '¿Cuál es la capital de Francia?') {
      assert.equal(body.organizationallyRelevant, false);
      assert.equal(body.sufficientKnowledge, false);
      assert.equal(typeof body.answer, 'string');
      assert.equal(body.answer.includes('demostración determinista'), false);
    }
  }
  for (const body of ['{"message":" "}', '{broken', '{}', '{"message":42}']) {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(await response.json() as object), ['error']);
  }
});
