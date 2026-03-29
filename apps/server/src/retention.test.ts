import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteMany = vi.fn();
const getSettings = vi.fn();
vi.mock('./prisma.js', () => ({ prisma: { message: { deleteMany } } }));
vi.mock('./settings.js', () => ({ getSettings }));

const { pruneExpiredMessages } = await import('./retention.js');

describe('message retention', () => {
  beforeEach(() => {
