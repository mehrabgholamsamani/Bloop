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
