import { createServer } from 'node:http';
import { createApp } from './app.js';
import { connectServices, db, redis } from './config/database.js';
import { env } from './config/env.js';
import { initRealtime, closeRealtimeRedis } from './services/realtime.js';
import { startDispatchSweeper } from './services/dispatch.js';

const server = createServer(createApp());
const io = initRealtime(server);
server.on('error', error => { console.error('Backend could not listen:', error.message); process.exit(1); });
server.listen(env.PORT, '0.0.0.0', () => console.log(`UzBite API listening on port ${env.PORT}`));
void connectServices().catch(() => console.warn('Database unavailable; /api/health reports readiness.'));
// Closes expired courier offers and searches by server time. It never assigns or completes a delivery.
const stopDispatchSweeper = startDispatchSweeper();
async function shutdown() {
  stopDispatchSweeper(); io.close(); server.close();
  await Promise.allSettled([db.$disconnect(), closeRealtimeRedis(), redis.isOpen ? redis.quit() : Promise.resolve()]);
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
