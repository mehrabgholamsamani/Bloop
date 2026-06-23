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
      clientEventSchema.safeParse({ type: 'reaction.toggle', messageId: id, emoji: '????' }).success,
