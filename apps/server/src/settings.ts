import { prisma } from './prisma.js';
export type Settings = {
  publicRoomEnabled: boolean;
  privateRoomEnabled: boolean;
  roomCapacity: number;
  messageRetentionDays: number;
};
const defaults: Settings = {
  publicRoomEnabled: true,
  privateRoomEnabled: true,
  roomCapacity: 30,
  messageRetentionDays: 7,
};
const settingsStore = prisma as unknown as {
  appSetting: {
    findMany: () => Promise<Array<{ key: string; value: string }>>;
    upsert: (args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }) => unknown;
