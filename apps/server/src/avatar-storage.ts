import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AvatarStorage {
  save(content: Buffer, extension: 'jpg' | 'png' | 'webp'): Promise<string>;
  remove(url: string | null): Promise<void>;
}

export class LocalAvatarStorage implements AvatarStorage {
  constructor(private readonly directory = process.env.AVATAR_UPLOAD_DIR ?? './uploads/avatars') {}
  async save(content: Buffer, extension: 'jpg' | 'png' | 'webp') {
    await mkdir(this.directory, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(join(this.directory, filename), content, { flag: 'wx' });
    return `/api/avatars/${filename}`;
  }
  async remove(url: string | null) {
    if (!url?.startsWith('/api/avatars/')) return;
    const filename = url.slice('/api/avatars/'.length);
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return;
    await rm(join(this.directory, filename), { force: true });
  }
}
