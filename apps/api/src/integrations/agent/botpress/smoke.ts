import type { QuestionAssessment } from '@nexa/shared';
import { BotpressAgentProvider } from '../BotpressAgentProvider.js';
import { BotpressRuntimeClient } from './BotpressRuntimeClient.js';

const cases: Array<{
  question: string;
  status: QuestionAssessment['status'];
  organizationallyRelevant: boolean;
  answerIncludes?: string;
}> = [
  {
    question: '¿Qué tóner utiliza la impresora MX550?',
    status: 'SUFFICIENT', organizationallyRelevant: true, answerIncludes: 'NX-550 Black',
  },
  {
    question: '¿Quiénes son los gerentes de la empresa?',
    status: 'SUFFICIENT', organizationallyRelevant: true,
  },
  {
    question: '¿Cuál es el procedimiento para dar de baja una impresora?',
    status: 'INSUFFICIENT', organizationallyRelevant: true,
  },
  {
    question: '¿Cómo está el clima en SPS?',
    status: 'INSUFFICIENT', organizationallyRelevant: false,
  },
];

function required(name: 'AGENT_PROVIDER' | 'BOTPRESS_TOKEN' | 'BOTPRESS_BOT_ID'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Botpress smoke test.`);
  return value;
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
  let latestTexts: string[] = [];
  const provider = new BotpressAgentProvider({
    ask: async (text) => {
      latestTexts = await runtime.ask(text);
      return latestTexts;
    },
  });
  for (const expected of cases) {
    let assessment: QuestionAssessment;
    try {
      assessment = await provider.assessQuestion({ question: expected.question });
    } catch (error) {
      console.error(JSON.stringify({ question: expected.question, providerTexts: latestTexts }, null, 2));
      throw error;
    }
    console.log(JSON.stringify({ question: expected.question, assessment }, null, 2));
    if (assessment.status !== expected.status
      || assessment.organizationallyRelevant !== expected.organizationallyRelevant
      || (expected.answerIncludes && !assessment.answer?.includes(expected.answerIncludes))) {
      throw new Error(`Unexpected Botpress assessment for: ${expected.question}`);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unknown Botpress smoke-test failure.');
  process.exitCode = 1;
}
