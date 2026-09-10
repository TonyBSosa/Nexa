import { createApp } from './app.js';
import { config } from './config/env.js';
import { createAgentProvider } from './integrations/agent/createAgentProvider.js';
import { openDatabase } from './persistence/database.js';
import { SQLiteKnowledgeRepository } from './repositories/knowledge.js';

const database = openDatabase(config.databasePath);
const app = createApp(createAgentProvider(config), new SQLiteKnowledgeRepository(database));

const server = app.listen(config.port, config.host, () => {
  console.log(`NEXA API: http://${config.host}:${config.port}`);
  console.log(`Agent provider: ${config.agentProvider}`);
});

server.on('error', (error) => {
  database.close();
  console.error('Unable to start NEXA API:', error.message);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => database.close()));
}
