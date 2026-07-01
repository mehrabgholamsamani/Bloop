import { z } from 'zod';

export const roomIdSchema = z.enum(['public', 'private']);
export type RoomId = z.infer<typeof roomIdSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bio: z.string(),
  avatarUrl: z.string().url().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(24).optional(),
    bio: z.string().trim().max(160).optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.bio !== undefined, {
    message: 'At least one profile field is required',
  });
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  roomId: roomIdSchema,
  authorId: z.string().uuid(),
  text: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  parentId: z.string().uuid().nullable(),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number().int().positive() })),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

const messageTextSchema = z.string().trim().min(1).max(500);
const encryptedMessageSchema = z
  .string()
  .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  .max(4096);
const clientRequestIdSchema = z.string().uuid();
export const reactionEmojiSchema = z.enum(['👍', '❤️', '😂', '🎉', '👀']);

export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room.join'), roomId: roomIdSchema }),
  z.object({
    type: z.literal('message.send'),
    text: messageTextSchema.optional(),
    ciphertext: encryptedMessageSchema.optional(),
    requestId: clientRequestIdSchema,
    parentId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('message.edit'),
    messageId: z.string().uuid(),
    text: messageTextSchema.optional(),
    ciphertext: encryptedMessageSchema.optional(),
  }),
  z.object({ type: z.literal('message.delete'), messageId: z.string().uuid() }),
  z.object({
    type: z.literal('reaction.toggle'),
    messageId: z.string().uuid(),
    emoji: reactionEmojiSchema,
  }),
  z.object({ type: z.literal('message.pin'), messageId: z.string().uuid() }),
  z.object({ type: z.literal('message.unpin') }),
  z.object({ type: z.literal('admin.user.kick'), userId: z.string().uuid() }),
  z.object({
    type: z.literal('admin.message.edit'),
    messageId: z.string().uuid(),
    text: messageTextSchema,
  }),
  z.object({ type: z.literal('admin.message.delete'), messageId: z.string().uuid() }),
  z.object({ type: z.literal('typing.start') }),
  z.object({ type: z.literal('typing.stop') }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection.ready'), user: publicUserSchema }),
  z.object({
    type: z.literal('room.joined'),
    roomId: roomIdSchema,
    users: z.array(publicUserSchema),
    messages: z.array(chatMessageSchema),
  }),
  z.object({ type: z.literal('room.accessDenied'), roomId: roomIdSchema }),
  z.object({ type: z.literal('room.full'), roomId: roomIdSchema }),
  z.object({
    type: z.literal('message.created'),
    message: chatMessageSchema,
    requestId: clientRequestIdSchema.optional(),
  }),
  z.object({ type: z.literal('message.updated'), message: chatMessageSchema }),
  z.object({
    type: z.literal('message.deleted'),
    messageId: z.string().uuid(),
    deletedAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal('reaction.updated'),
    messageId: z.string().uuid(),
    reactions: z.array(z.object({ emoji: z.string(), count: z.number().int().positive() })),
  }),
  z.object({
    type: z.literal('message.pinned'),
    roomId: roomIdSchema,
    messageId: z.string().uuid().nullable(),
  }),
  z.object({ type: z.literal('profile.updated'), user: publicUserSchema }),
  z.object({ type: z.literal('user.joined'), user: publicUserSchema }),
  z.object({ type: z.literal('user.left'), userId: z.string().uuid() }),
  z.object({ type: z.literal('users.updated'), users: z.array(publicUserSchema) }),
  z.object({ type: z.literal('typing.updated'), userIds: z.array(z.string().uuid()) }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
