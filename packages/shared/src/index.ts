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
export const reactionEmojiSchema = z.enum(['????', '??????', '????', '????', '????']);

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
