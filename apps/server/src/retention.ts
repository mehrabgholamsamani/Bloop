import { prisma } from './prisma.js';
import { getSettings } from './settings.js';

export async function pruneExpiredMessages() {
  const { messageRetentionDays } = await getSettings();
  const cutoff = new Date(Date.now() - messageRetentionDays * 86_400_000);
  return prisma.message.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
