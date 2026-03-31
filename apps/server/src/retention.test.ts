import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteMany = vi.fn();
const getSettings = vi.fn();
vi.mock('./prisma.js', () => ({ prisma: { message: { deleteMany } } }));
vi.mock('./settings.js', () => ({ getSettings }));

const { pruneExpiredMessages } = await import('./retention.js');

describe('message retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ messageRetentionDays: 7 });
    deleteMany.mockResolvedValue({ count: 2 });
  });
  it('deletes only messages older than the configured retention period', async () => {
    await pruneExpiredMessages();
    expect(deleteMany).toHaveBeenCalledOnce();
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(7 * 86_400_000 - 1_000);
  });
});
