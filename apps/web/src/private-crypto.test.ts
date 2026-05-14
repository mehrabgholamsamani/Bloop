import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptPrivateText, derivePrivateRoomKey, encryptPrivateText } from './private-crypto';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

describe('private room encryption', () => {
  it('round-trips a private message only with the same password-derived key', async () => {
