import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export type AgentProviderName = 'fake' | 'botpress';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  agentProvider: AgentProviderName;
  botpress?: {
    token: string;
    botId: string;
    integrationName?: string;
  };
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const configuredPort = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const configuredDatabasePath = environment.DATABASE_PATH ?? './data/nexa.db';
  if (!configuredDatabasePath.trim()) throw new Error('DATABASE_PATH must not be empty.');
  const agentProvider = environment.AGENT_PROVIDER ?? 'fake';
  if (agentProvider !== 'fake' && agentProvider !== 'botpress') {
    throw new Error('AGENT_PROVIDER must be either "fake" or "botpress".');
  }
  const base = {
    port: configuredPort,
    host: '127.0.0.1',
    databasePath: configuredDatabasePath === ':memory:' ? configuredDatabasePath : resolve(repositoryRoot, configuredDatabasePath),
    agentProvider,
  } satisfies AppConfig;
  if (agentProvider === 'fake') return base;
  const token = environment.BOTPRESS_TOKEN?.trim();
  const botId = environment.BOTPRESS_BOT_ID?.trim();
  const integrationName = environment.BOTPRESS_INTEGRATION_NAME?.trim();
  if (!token) throw new Error('BOTPRESS_TOKEN is required when AGENT_PROVIDER=botpress.');
  if (!botId) throw new Error('BOTPRESS_BOT_ID is required when AGENT_PROVIDER=botpress.');
  return {
    ...base,
    botpress: {
      token,
      botId,
      ...(integrationName && { integrationName }),
    },
  };
}

export const config = readConfig();
