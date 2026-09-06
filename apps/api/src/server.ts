import { createApp } from './app.js';
import { config } from './config/env.js';
import { FakeAgentProvider } from './integrations/agent/FakeAgentProvider.js';
import { openDatabase } from './persistence/database.js';
import { SQLiteKnowledgeRepository } from './repositories/knowledge.js';

const database = openDatabase(config.databasePath);
const app = createApp(new FakeAgentProvider(process.env.NODE_ENV !== 'production'), new SQLiteKnowledgeRepository(database));

const server = app.listen(config.port, config.host, () => {
  console.log(`NEXA API: http://${config.host}:${config.port}`);
});

server.on('error', (error) => {
  database.close();
  console.error('Unable to start NEXA API:', error.message);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => database.close()));
}
