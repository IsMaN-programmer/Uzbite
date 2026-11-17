import concurrently from 'concurrently';
import {resolve} from 'node:path';
import {startLocalPostgres} from './local-postgres.mjs';

let stopDatabase;
try {
  // Wait for PostgreSQL before starting anything that queries it.
  stopDatabase = await startLocalPostgres();
  const {result} = concurrently([
    {command: 'npm run dev -w @uzbite/backend', name: 'api', prefixColor: 'yellow'},
    {command: 'npm run dev -w @uzbite/frontend', name: 'web', prefixColor: 'cyan'},
  ], {cwd: resolve(import.meta.dirname, '..'), killOthersOn: ['success', 'failure']});
  await result;
} catch (error) {
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
} finally {
  await stopDatabase?.();
}
