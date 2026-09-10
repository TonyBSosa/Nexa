import type { AppConfig } from '../../config/env.js';
import type { AgentProvider } from './AgentProvider.js';
import { BotpressAgentProvider } from './BotpressAgentProvider.js';
import { FakeAgentProvider } from './FakeAgentProvider.js';
import { BotpressRuntimeClient } from './botpress/BotpressRuntimeClient.js';

export function createAgentProvider(config: AppConfig): AgentProvider {
  if (config.agentProvider === 'fake') {
    return new FakeAgentProvider(process.env.NODE_ENV !== 'production');
  }
  if (!config.botpress) throw new Error('Botpress configuration is required.');
  return new BotpressAgentProvider(
    new BotpressRuntimeClient(config.botpress),
    process.env.NODE_ENV === 'production' ? undefined : console,
  );
}
