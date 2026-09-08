import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenError, UnauthorizedError } from '@botpress/client';
import type { QuestionAssessment } from '@nexa/shared';
import { readConfig } from '../src/config/env.js';
import { DomainError } from '../src/domain/workflow.js';
import { BotpressAgentProvider } from '../src/integrations/agent/BotpressAgentProvider.js';
import { FakeAgentProvider } from '../src/integrations/agent/FakeAgentProvider.js';
import {
  BotpressRuntimeClient,
  BotpressRuntimeError,
} from '../src/integrations/agent/botpress/BotpressRuntimeClient.js';
import type { BotpressRuntimeApi } from '../src/integrations/agent/botpress/BotpressRuntimeClient.js';
import { createAgentProvider } from '../src/integrations/agent/createAgentProvider.js';
import { openDatabase } from '../src/persistence/database.js';
import { SQLiteKnowledgeRepository } from '../src/repositories/knowledge.js';
import { ChatService } from '../src/services/chat.js';

type RuntimeCall = { operation: string; input: unknown };

function runtimeFor(agentText: string | string[], calls: RuntimeCall[] = []): BotpressRuntimeClient {
  let responseIndex = 0;
  const runtime: BotpressRuntimeApi = {
    listConversations: (input) => {
      calls.push({ operation: 'listConversations', input });
      return Promise.resolve({ conversations: [{ channel: 'channel', integration: 'webchat' }] });
    },
    getBot: (input) => {
      calls.push({ operation: 'getBot', input });
      return Promise.resolve({ bot: { integrations: {
        webchat: { id: 'integration-webchat', name: 'webchat', enabled: true, status: 'registered' },
      } } });
    },
    createUser: (input) => {
      calls.push({ operation: 'createUser', input });
      return Promise.resolve({ user: { id: 'user-new' } });
    },
    createConversation: (input) => {
      calls.push({ operation: 'createConversation', input });
      return Promise.resolve({ conversation: { id: 'conversation-new' } });
    },
    createMessage: (input) => {
      calls.push({ operation: 'createMessage', input });
      return Promise.resolve({ message: { id: 'message-in', createdAt: '2026-09-07T12:00:00.000Z' } });
    },
    listMessages: (input) => {
      calls.push({ operation: 'listMessages', input });
      const index = Array.isArray(agentText) ? Math.min(responseIndex++, agentText.length - 1) : 0;
      return Promise.resolve({ messages: [{
        id: `message-out-${index}`, createdAt: '2026-09-07T12:00:01.000Z', conversationId: 'conversation-new',
        direction: 'outgoing', type: 'text', payload: { text: Array.isArray(agentText) ? agentText[index]! : agentText },
      }] });
    },
  };
  return new BotpressRuntimeClient({
    token: 'test-token', botId: 'test-bot',
    clientFactory: (integrationId) => {
      if (integrationId) calls.push({ operation: 'scopeIntegration', input: { integrationId } });
      return runtime;
    },
    requestTimeoutMs: 100, pollTimeoutMs: 100, pollIntervalMs: 1, responseSettleMs: 0,
  });
}

function failingRuntime(error: Error): BotpressRuntimeClient {
  const unused = () => Promise.reject(new Error('Unexpected Runtime operation'));
  const runtime: BotpressRuntimeApi = {
    listConversations: () => Promise.reject(error),
    getBot: unused,
    createUser: unused,
    createConversation: unused,
    createMessage: unused,
    listMessages: unused,
  };
  return new BotpressRuntimeClient({
    token: 'test-token', botId: 'test-bot',
    clientFactory: () => runtime,
  });
}

function envelope(assessment: QuestionAssessment): string {
  return JSON.stringify({
    schema: 'nexa.assessment.v1',
    organizationallyRelevant: assessment.organizationallyRelevant,
    status: assessment.status,
    answer: assessment.answer,
    evidence: assessment.evidence.map(({ sourceId, title, documentId, locator }) => ({
      source: sourceId, label: title,
      ...(documentId && { documentId }), ...(locator && { locator }),
    })),
    ...('suggestedCategory' in assessment && { suggestedCategory: assessment.suggestedCategory }),
    ...('suggestedDepartment' in assessment && { suggestedDepartment: assessment.suggestedDepartment }),
    ...('suggestedExperts' in assessment && { suggestedExperts: assessment.suggestedExperts }),
    ...('suggestedActions' in assessment && { suggestedActions: assessment.suggestedActions }),
  });
}

test('official-client flow discovers context and returns a structured sufficient assessment', async () => {
  const calls: RuntimeCall[] = [];
  const provider = new BotpressAgentProvider(runtimeFor(envelope({
    status: 'SUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true,
    answer: 'La MX550 utiliza NX-550 Black.',
    evidence: [{ sourceId: 'equipment-guide', title: 'Guía de equipos', documentId: 'mx550' }],
  }), calls));
  const result = await provider.assessQuestion({ question: '¿Qué tóner utiliza la impresora MX550?' });
  assert.equal(result.status, 'SUFFICIENT');
  assert.equal(result.answer, 'La MX550 utiliza NX-550 Black.');
  assert.deepEqual(calls.map((call) => call.operation), [
    'listConversations', 'getBot', 'scopeIntegration',
    'createUser', 'createConversation', 'createMessage', 'listMessages',
  ]);
  assert.deepEqual(calls[0]!.input, { sortField: 'updatedAt', sortDirection: 'desc', pageSize: 50 });
  assert.deepEqual(calls[1]!.input, { id: 'test-bot' });
  assert.deepEqual(calls[2]!.input, { integrationId: 'integration-webchat' });
  assert.equal('integrationName' in (calls[3]!.input as object), false);
  assert.equal('integrationName' in (calls[4]!.input as object), false);
  assert.equal((calls[5]!.input as { conversationId: string }).conversationId, 'conversation-new');
  assert.equal((calls[5]!.input as { payload: { text: string } }).payload.text,
    'NEXA_ASSESSMENT_V1\n\n¿Qué tóner utiliza la impresora MX550?');
  assert.equal('origin' in (calls[5]!.input as object), false);
});

test('structured Botpress assessments preserve insufficient and non-organizational outcomes', async () => {
  const cases: QuestionAssessment[] = [{
    status: 'INSUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true,
    answer: null, evidence: [], suggestedCategory: 'TI / Equipos', suggestedDepartment: 'Soporte de TI',
    suggestedExperts: ['Coordinador de TI'],
    suggestedActions: [{ type: 'REQUEST_INFORMATION', description: 'Solicitar el procedimiento.' }],
  }, {
    status: 'INSUFFICIENT', organizationallyRelevant: false, retrievalCompleted: true,
    answer: null, evidence: [],
  }];
  for (const assessment of cases) {
    const result = await new BotpressAgentProvider(runtimeFor(envelope(assessment)))
      .assessQuestion({ question: 'Pregunta' });
    assert.equal(result.status, assessment.status);
    assert.equal(result.organizationallyRelevant, assessment.organizationallyRelevant);
    assert.equal(result.retrievalCompleted, assessment.retrievalCompleted);
    assert.equal(result.answer, null);
    assert.deepEqual(result.evidence, []);
    if (result.status !== 'INSUFFICIENT') throw new Error('Expected INSUFFICIENT assessment');
    if (assessment.organizationallyRelevant) {
      assert.equal(result.suggestedDepartment, 'Soporte de TI');
      assert.equal(result.suggestedActions?.[0]?.type, 'REQUEST_INFORMATION');
    }
  }
});

test('provider ignores interim prose and waits for the structured assessment', async () => {
  const assessment: QuestionAssessment = {
    status: 'INSUFFICIENT', organizationallyRelevant: true, retrievalCompleted: true,
    answer: null, evidence: [], suggestedCategory: 'TI / Equipos', suggestedDepartment: 'Soporte de TI',
    suggestedExperts: [], suggestedActions: [],
  };
  const finalEnvelope = envelope(assessment);
  const result = await new BotpressAgentProvider(runtimeFor([
    'Let me search the internal knowledge base for this.',
    finalEnvelope,
  ])).assessQuestion({ question: 'Procedimiento interno' });
  assert.equal(result.status, 'INSUFFICIENT');
  assert.equal(result.organizationallyRelevant, true);
});

test('adapter maps explicit Botpress insufficient fields into the neutral contract', async () => {
  const provider = new BotpressAgentProvider(runtimeFor(JSON.stringify({
    schema: 'nexa.assessment.v1',
    organizationallyRelevant: true,
    status: 'INSUFFICIENT',
    answer: 'No encontré un procedimiento documentado.',
    evidence: [],
    suggestedActions: ['REQUEST_DOCUMENT', 'REQUEST_INFORMATION'],
  })));
  const result = await provider.assessQuestion({ question: 'Procedimiento interno' });
  assert.equal(result.status, 'INSUFFICIENT');
  assert.equal(result.answer, null);
  assert.deepEqual(result.suggestedActions?.map((action) => action.type), [
    'REQUEST_DOCUMENT', 'REQUEST_INFORMATION',
  ]);
});

test('Runtime failures remain safe for the domain and do not create gaps', async (t) => {
  const provider = new BotpressAgentProvider(failingRuntime(new DOMException('request timed out', 'TimeoutError')));
  const assessment = await provider.assessQuestion({ question: 'Pregunta organizacional' });
  assert.equal(assessment.status, 'FAILURE');
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  const repository = new SQLiteKnowledgeRepository(database);
  const result = await new ChatService(provider, repository).chat({ message: 'Pregunta organizacional' });
  assert.equal(result.status, 'FAILURE');
  assert.equal(repository.listGaps().length, 0);
  assert.equal(repository.listQueries().length, 1);
  assert.equal(repository.listQueries()[0]!.knowledgeGapId, null);
});

test('official client authentication and authorization errors retain safe internal classifications', async () => {
  const cases = [
    { error: new UnauthorizedError('Token rejected'), kind: 'AUTHENTICATION_ERROR', status: 401 },
    { error: new ForbiddenError('Operation denied'), kind: 'AUTHORIZATION_ERROR', status: 403 },
  ] as const;
  for (const item of cases) {
    await assert.rejects(
      failingRuntime(item.error).ask('Pregunta'),
      (error: unknown) => error instanceof BotpressRuntimeError
        && error.kind === item.kind
        && error.operation === 'listConversations'
        && error.status === item.status,
    );
  }
});

test('malformed Botpress envelopes use the existing safe invalid-provider behavior without writes', async (t) => {
  const provider = new BotpressAgentProvider(runtimeFor('{"unexpected":true}'));
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  const repository = new SQLiteKnowledgeRepository(database);
  await assert.rejects(
    new ChatService(provider, repository).chat({ message: 'Pregunta' }),
    (error: unknown) => error instanceof DomainError && error.code === 'INVALID_PROVIDER_RESPONSE'
      && !error.message.includes('unexpected'),
  );
  assert.equal(repository.listQueries().length, 0);
  assert.equal(repository.listGaps().length, 0);
});

test('provider configuration defaults to fake and validates Botpress startup settings', () => {
  const fakeConfig = readConfig({ DATABASE_PATH: ':memory:' });
  assert.equal(fakeConfig.agentProvider, 'fake');
  assert.ok(createAgentProvider(fakeConfig) instanceof FakeAgentProvider);
  assert.throws(() => readConfig({ DATABASE_PATH: ':memory:', AGENT_PROVIDER: 'botpress' }), /BOTPRESS_TOKEN/);
  assert.throws(() => readConfig({
    DATABASE_PATH: ':memory:', AGENT_PROVIDER: 'botpress', BOTPRESS_TOKEN: 'token',
  }), /BOTPRESS_BOT_ID/);
  const botpressConfig = readConfig({
    DATABASE_PATH: ':memory:', AGENT_PROVIDER: 'botpress', BOTPRESS_TOKEN: 'token', BOTPRESS_BOT_ID: 'bot',
  });
  assert.equal(botpressConfig.botpress?.integrationName, undefined);
  assert.ok(createAgentProvider(botpressConfig) instanceof BotpressAgentProvider);
  assert.equal(readConfig({
    DATABASE_PATH: ':memory:', AGENT_PROVIDER: 'botpress', BOTPRESS_TOKEN: 'token', BOTPRESS_BOT_ID: 'bot',
    BOTPRESS_INTEGRATION_NAME: 'webchat',
  }).botpress?.integrationName, 'webchat');
});
