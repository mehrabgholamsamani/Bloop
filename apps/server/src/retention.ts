import { prisma } from './prisma.js';
import { getSettings } from './settings.js';

export async function pruneExpiredMessages() {
