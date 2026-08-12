import 'dotenv/config';
import { buildApp } from './app.js';
import { prisma } from './prisma.js';
import { attachWebSocket } from './ws-server.js';
import { pruneExpiredMessages } from './retention.js';

const app = buildApp();
const sockets = await attachWebSocket(app.server);
const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
await pruneExpiredMessages();
const retentionTimer = setInterval(
  () => {
    void pruneExpiredMessages();
  },
  60 * 60 * 1000,
);

async function shutdown() {
  clearInterval(retentionTimer);
  await sockets.close();
  await app.close();
  await prisma.$disconnect();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
