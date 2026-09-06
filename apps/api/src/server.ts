import { createApp } from './app.js';
import { config } from './config/env.js';
import { FakeAgentProvider } from './integrations/agent/FakeAgentProvider.js';

const app = createApp(new FakeAgentProvider(process.env.NODE_ENV !== 'production'));

const server = app.listen(config.port, config.host, () => {
  console.log(`NEXA API: http://${config.host}:${config.port}`);
});

server.on('error', (error) => {
  console.error('Unable to start NEXA API:', error.message);
  process.exitCode = 1;
});
