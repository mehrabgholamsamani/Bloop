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
  };
};
export async function getSettings(): Promise<Settings> {
  const rows = await settingsStore.appSetting.findMany();
  return rows.reduce(
    (settings, row) => ({ ...settings, [row.key]: JSON.parse(row.value) }),
    defaults,
  ) as Settings;
}
export async function saveSettings(settings: Settings) {
  await Promise.all(
    Object.entries(settings).map(([key, value]) =>
      settingsStore.appSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );
  return settings;
}
