import { describe, expect, it } from 'vitest';
import { clientEventSchema, profileUpdateSchema, serverEventSchema } from './index.js';
describe('shared schemas', () => {
  it('rejects malformed events', () =>
    expect(clientEventSchema.safeParse({ type: 'message.send', text: '' }).success).toBe(false));
  it('strictly validates profiles', () => {
    expect(profileUpdateSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ name: 'Guest', extra: true }).success).toBe(false);
  });
  it('validates replies, reactions, pins, and admin moderation events', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      clientEventSchema.safeParse({
        type: 'message.send',
        text: 'Reply',
        requestId: id,
        parentId: id,
      }).success,
    ).toBe(true);
    expect(
      clientEventSchema.safeParse({ type: 'reaction.toggle', messageId: id, emoji: '👍' }).success,
    ).toBe(true);
    expect(
      clientEventSchema.safeParse({ type: 'reaction.toggle', messageId: id, emoji: 'not-an-emoji' })
        .success,
    ).toBe(false);
    expect(clientEventSchema.safeParse({ type: 'admin.user.kick', userId: id }).success).toBe(true);
  });
  it('validates reaction and pin broadcast events', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      serverEventSchema.safeParse({
        type: 'reaction.updated',
        messageId: id,
        reactions: [{ emoji: '👍', count: 1 }],
      }).success,
    ).toBe(true);
    expect(
      serverEventSchema.safeParse({ type: 'message.pinned', roomId: 'public', messageId: null })
        .success,
    ).toBe(true);
  });
});
