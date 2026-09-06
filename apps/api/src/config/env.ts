import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const databasePath = process.env.DATABASE_PATH ?? './data/nexa.db';
if (!databasePath.trim()) throw new Error('DATABASE_PATH must not be empty.');

export const config = {
  port, host: '127.0.0.1',
  databasePath: databasePath === ':memory:' ? databasePath : resolve(repositoryRoot, databasePath),
};
