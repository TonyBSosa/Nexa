import { randomUUID } from 'node:crypto';
import type { ChatResponse } from '@nexa/shared';
import { BotpressAgentProvider } from '../BotpressAgentProvider.js';
import { BotpressRuntimeClient } from './BotpressRuntimeClient.js';
import { BotpressRuntimeError } from './BotpressRuntimeClient.js';
import { openDatabase } from '../../../persistence/database.js';
import { SQLiteKnowledgeRepository } from '../../../repositories/knowledge.js';
import { ChatService } from '../../../services/chat.js';

const cases: Array<{
  name: string;
  question: string;
  status: ChatResponse['status'];
  organizationallyRelevant: boolean;
  answerIncludes?: string;
}> = [
  ...Array.from({ length: 5 }, (_, index) => ({
    name: `mx550-${index + 1}`,
    question: '¿Qué tóner utiliza la impresora MX550?',
    status: 'SUFFICIENT' as const, organizationallyRelevant: true, answerIncludes: 'NX-550 Black',
  })),
  {
    name: 'managers',
    question: '¿Quiénes son los gerentes de la empresa?',
    status: 'SUFFICIENT', organizationallyRelevant: true,
  },
  {
    name: 'late-arrival-policy',
    question: '¿Existe una política para llegadas tarde?',
    status: 'INSUFFICIENT', organizationallyRelevant: true,
  },
  {
    name: 'france-time',
    question: '¿Qué hora es en Francia?',
    status: 'INSUFFICIENT', organizationallyRelevant: false,
  },
];

function required(name: 'AGENT_PROVIDER' | 'BOTPRESS_TOKEN' | 'BOTPRESS_BOT_ID'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Botpress smoke test.`);
  return value;
}

function summarizeProviderText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith('```json') && trimmed.endsWith('```')
    ? trimmed.slice(7, -3).trim()
    : trimmed;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { format: 'json', valueType: Array.isArray(parsed) ? 'array' : typeof parsed };
    }
    const value = parsed as Record<string, unknown>;
    return {
      format: 'json', keys: Object.keys(value),
      schema: value.schema, status: value.status,
      organizationallyRelevant: value.organizationallyRelevant,
      answerType: value.answer === null ? 'null' : typeof value.answer,
      evidenceCount: Array.isArray(value.evidence) ? value.evidence.length : 'not-array',
    };
  } catch {
    return {
      format: 'text', length: trimmed.length,
      containsSchemaMarker: trimmed.includes('nexa.assessment.v1'),
      containsJsonFence: /```(?:json)?/i.test(trimmed),
      containsObjectBounds: trimmed.includes('{') && trimmed.includes('}'),
    };
  }
}

async function main() {
  if (required('AGENT_PROVIDER') !== 'botpress') {
    throw new Error('AGENT_PROVIDER must be botpress for the Botpress smoke test.');
  }
  const runtime = new BotpressRuntimeClient({
    token: required('BOTPRESS_TOKEN'),
    botId: required('BOTPRESS_BOT_ID'),
    ...(process.env.BOTPRESS_INTEGRATION_NAME?.trim()
      && { integrationName: process.env.BOTPRESS_INTEGRATION_NAME.trim() }),
  });
  const events: string[] = [];
  let attemptSummaries: Array<Record<string, unknown>> = [];
  const diagnosticRuntime = {
    ask: async (text: string, responseComplete?: (texts: string[]) => boolean) => {
      try {
        const texts = await runtime.ask(text, responseComplete);
        attemptSummaries.push(...texts.map(summarizeProviderText));
        return texts;
      } catch (error) {
        attemptSummaries.push(error instanceof BotpressRuntimeError
          ? { runtimeError: error.kind, operation: error.operation, status: error.status }
          : { runtimeError: 'UNKNOWN' });
        throw error;
      }
    },
  };
  const provider = new BotpressAgentProvider(diagnosticRuntime, {
    info: (message) => events.push(message),
    warn: (message) => events.push(message),
  });
  const database = openDatabase(':memory:');
  try {
    const service = new ChatService(provider, new SQLiteKnowledgeRepository(database));
    const failures: string[] = [];
    for (const expected of cases) {
      const eventStart = events.length;
      attemptSummaries = [];
      const response = await service.chat({
        message: expected.question,
        clientSessionId: randomUUID(),
      });
      const providerEvents = events.slice(eventStart);
      console.log(JSON.stringify({ name: expected.name, response, providerEvents, attemptSummaries }, null, 2));
      if (response.status !== expected.status
        || response.organizationallyRelevant !== expected.organizationallyRelevant
        || (expected.answerIncludes && !response.answer.includes(expected.answerIncludes))) {
        failures.push(expected.name);
      }
    }
    if (failures.length) throw new Error(`Unexpected Botpress assessments: ${failures.join(', ')}`);
  } finally {
    database.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unknown Botpress smoke-test failure.');
  process.exitCode = 1;
}
