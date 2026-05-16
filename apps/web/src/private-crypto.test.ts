import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptPrivateText, derivePrivateRoomKey, encryptPrivateText } from './private-crypto';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('private room encryption', () => {
  it('round-trips a private message only with the same password-derived key', async () => {
    const key = await derivePrivateRoomKey('shared room password');
    const payload = await encryptPrivateText(key, 'A private hello');

    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(decryptPrivateText(key, payload)).resolves.toBe('A private hello');
    await expect(
      decryptPrivateText(await derivePrivateRoomKey('incorrect password'), payload),
    ).rejects.toThrow();
  });
});
