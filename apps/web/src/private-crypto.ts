const encoder = new TextEncoder();
const privateRoomSalt = encoder.encode('chatroom/private-room/e2ee/v1');

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

export async function derivePrivateRoomKey(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: privateRoomSalt, iterations: 310_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPrivateText(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decryptPrivateText(key: CryptoKey, payload: string): Promise<string> {
  const [version, iv, ciphertext, extra] = payload.split('.');
  if (version !== 'v1' || !iv || !ciphertext || extra)
    throw new Error('Invalid encrypted message.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    key,
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
