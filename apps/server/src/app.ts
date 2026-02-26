import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { profileUpdateSchema, roomIdSchema } from '@chatroom/shared';
import argon2 from 'argon2';
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { LocalAvatarStorage } from './avatar-storage.js';
import { resolveSession } from './auth.js';
import { prisma } from './prisma.js';
import { getSettings, saveSettings } from './settings.js';
import { broadcastProfileUpdate } from './ws-server.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    requestTimeout: 15_000,
    routerOptions: { maxParamLength: 128 },
  });
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173';
  void app.register(cookie);
  void app.register(multipart, { limits: { files: 1, fileSize: 3 * 1024 * 1024 } });
  void app.register(cors, { origin: publicOrigin, credentials: true });
  void app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:",
      );
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.status(400).send({ code: 'VALIDATION_ERROR', issues: error.issues });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) return reply.send(error);
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error.' });
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  });
  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/health')
      await resolveSession(request, reply);
  });
  app.get('/api/me', async (request) => ({ user: request.auth.user }));
  const adminCookie = 'chatroom_admin';
  const adminToken = () =>
    createHmac('sha256', process.env.SESSION_SECRET ?? '')
      .update(process.env.ADMIN_SECRET ?? '')
      .digest('base64url');
  const isAdmin = (request: { cookies: Record<string, string | undefined> }) => {
    const token = request.cookies[adminCookie];
    const expected = adminToken();
    return Boolean(
      token &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected)),
    );
  };
  const adminOnly = async (
    request: { cookies: Record<string, string | undefined> },
    reply: { status: (code: number) => { send: (body: object) => unknown } },
  ) => {
    if (!isAdmin(request))
      return reply.status(401).send({ code: 'ADMIN_REQUIRED', message: 'Admin access required.' });
  };
  app.post('/api/admin/login', async (request, reply) => {
    const secret = (request.body as { secret?: unknown })?.secret;
    if (
      typeof secret !== 'string' ||
      !process.env.ADMIN_SECRET ||
      secret.length !== process.env.ADMIN_SECRET.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(process.env.ADMIN_SECRET))
    )
      return reply
        .status(401)
        .send({ code: 'INVALID_ADMIN_SECRET', message: 'Invalid admin secret.' });
    reply.setCookie(adminCookie, adminToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return { authenticated: true };
  });
  app.post('/api/admin/logout', async (_request, reply) => {
    reply.clearCookie(adminCookie, { path: '/' });
    return { authenticated: false };
  });
  app.get('/api/admin/settings', async (request, reply) => {
    if (await adminOnly(request, reply)) return;
    return getSettings();
  });
  app.patch('/api/admin/settings', async (request, reply) => {
    if (await adminOnly(request, reply)) return;
    const body = request.body as Partial<Awaited<ReturnType<typeof getSettings>>>;
    const { publicRoomEnabled, privateRoomEnabled, roomCapacity, messageRetentionDays } = body;
    if (
      typeof publicRoomEnabled !== 'boolean' ||
      typeof privateRoomEnabled !== 'boolean' ||
      typeof roomCapacity !== 'number' ||
      typeof messageRetentionDays !== 'number' ||
      !Number.isInteger(roomCapacity) ||
      roomCapacity < 1 ||
      roomCapacity > 30 ||
      !Number.isInteger(messageRetentionDays) ||
      messageRetentionDays < 1 ||
      messageRetentionDays > 365
    )
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid settings.' });
    return saveSettings({
      publicRoomEnabled,
      privateRoomEnabled,
      roomCapacity,
      messageRetentionDays,
    });
  });
  // Prisma's local generated client can lag while another development process holds its engine lock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moderation = prisma as unknown as any;
  const audit = (action: string, targetId?: string) =>
    moderation.adminAuditLog.create({ data: { action, targetId } });
  app.post('/api/reports', async (request, reply) => {
    const body = request.body as { messageId?: unknown; reason?: unknown };
    if (
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.length > 300
    )
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'A 3–300 character reason is required.' });
    return moderation.report.create({
      data: {
        reporterId: request.auth.user.id,
        messageId: typeof body.messageId === 'string' ? body.messageId : null,
        reason: body.reason.trim(),
      },
    });
  });
  app.get('/api/admin/reports', async (request, reply) => {
    if (await adminOnly(request, reply)) return;
    return moderation.report.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
  app.post('/api/admin/users/:id/:kind', async (request, reply) => {
    if (await adminOnly(request, reply)) return;
    const { id, kind } = request.params as { id: string; kind: string };
    if (kind !== 'ban' && kind !== 'mute')
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Invalid moderation action.' });
    const body = request.body as { reason?: unknown; expiresAt?: unknown };
    const expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;
    await moderation.moderationAction.create({
      data: {
        userId: id,
        kind,
        expiresAt,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : null,
      },
    });
    await audit(`user.${kind}`, id);
    return { ok: true };
  });
  app.delete('/api/admin/users/:id/:kind', async (request, reply) => {
    if (await adminOnly(request, reply)) return;
    const { id, kind } = request.params as { id: string; kind: string };
    await moderation.moderationAction.deleteMany({ where: { userId: id, kind } });
    await audit(`user.${kind}.clear`, id);
    return { ok: true };
  });
  app.get('/api/rooms/:roomId/messages/search', async (request, reply) => {
    const roomId = roomIdSchema.parse((request.params as { roomId: string }).roomId);
    if (roomId === 'private')
      return reply.status(400).send({
        code: 'E2EE_SEARCH_UNAVAILABLE',
        message: 'Private encrypted messages cannot be searched by the server.',
      });
    const q = (request.query as { q?: unknown }).q;
    if (typeof q !== 'string' || q.trim().length < 2 || q.trim().length > 100)
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Search query must be 2–100 characters.' });
    const messages = await prisma.message.findMany({
      where: { roomId, deletedAt: null, text: { contains: q.trim(), mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { reactions: { select: { emoji: true } } },
    });
    return {
      messages: messages.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        authorId: m.authorId,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt?.toISOString() ?? null,
        deletedAt: null,
        parentId: m.parentId,
        reactions: Object.entries(
          m.reactions.reduce<Record<string, number>>(
            (a, r) => ({ ...a, [r.emoji]: (a[r.emoji] ?? 0) + 1 }),
            {},
          ),
        ).map(([emoji, count]) => ({ emoji, count })),
      })),
    };
  });
  app.patch('/api/me', async (request) => {
    const update = profileUpdateSchema.parse(request.body);
    const user = await prisma.user.update({ where: { id: request.auth.user.id }, data: update });
    request.auth.user = { id: user.id, name: user.name, bio: user.bio, avatarUrl: user.avatarUrl };
    broadcastProfileUpdate(request.auth.user);
    return { user: request.auth.user };
  });
  const attempts = new Map<string, { count: number; resetAt: number }>();
  app.post('/api/rooms/private/access', async (request, reply) => {
    const body = request.body as { password?: unknown };
    const password = typeof body?.password === 'string' ? body.password : '';
    const now = Date.now();
    const entry = attempts.get(request.ip);
    if (entry && entry.resetAt > now && entry.count >= 5)
      return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Try again later.' });
    const hash = process.env.PRIVATE_ROOM_PASSWORD_HASH;
    const valid = Boolean(hash && password && (await argon2.verify(hash, password)));
    if (!valid) {
      attempts.set(request.ip, {
        count: (entry?.resetAt ?? 0) > now ? (entry?.count ?? 0) + 1 : 1,
        resetAt: now + 60_000,
      });
      return reply
        .status(401)
        .send({ code: 'ACCESS_DENIED', message: 'Unable to grant private-room access.' });
    }
    attempts.delete(request.ip);
    const expiresAt = new Date(now + 12 * 60 * 60 * 1000);
    await prisma.privateRoomAccess.deleteMany({ where: { sessionId: request.auth.id } });
    await prisma.privateRoomAccess.create({ data: { sessionId: request.auth.id, expiresAt } });
    return { granted: true, expiresAt: expiresAt.toISOString() };
  });
  app.get('/api/rooms/private/access', async (request) => {
    const access = await prisma.privateRoomAccess.findFirst({
      where: { sessionId: request.auth.id, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    return { granted: Boolean(access), expiresAt: access?.expiresAt.toISOString() ?? null };
  });
  app.delete('/api/rooms/private/access', async (request) => {
    await prisma.privateRoomAccess.deleteMany({ where: { sessionId: request.auth.id } });
    return { granted: false, expiresAt: null };
  });
  const storage = new LocalAvatarStorage();
  app.post('/api/me/avatar', async (request, reply) => {
    const upload = await request.file();
    if (!upload)
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'An avatar file is required.' });
    const content = await upload.toBuffer();
    const kind = content.subarray(0, 12);
    const extension =
      kind.subarray(0, 3).toString('hex') === 'ffd8ff'
        ? 'jpg'
        : kind.subarray(0, 8).toString() === '\x89PNG\r\n\x1a\n'
          ? 'png'
          : kind.subarray(0, 4).toString() === 'RIFF' && kind.subarray(8, 12).toString() === 'WEBP'
            ? 'webp'
            : null;
    if (!extension)
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Use a JPEG, PNG, or WebP image.' });
    const previous = request.auth.user.avatarUrl;
    const avatarUrl = await storage.save(content, extension);
    const user = await prisma.user.update({
      where: { id: request.auth.user.id },
      data: { avatarUrl },
    });
    await storage.remove(previous);
    request.auth.user = { id: user.id, name: user.name, bio: user.bio, avatarUrl: user.avatarUrl };
    broadcastProfileUpdate(request.auth.user);
    return { user: request.auth.user };
  });
  app.delete('/api/me/avatar', async (request) => {
    const previous = request.auth.user.avatarUrl;
    const user = await prisma.user.update({
      where: { id: request.auth.user.id },
      data: { avatarUrl: null },
    });
    await storage.remove(previous);
    request.auth.user = { id: user.id, name: user.name, bio: user.bio, avatarUrl: user.avatarUrl };
    broadcastProfileUpdate(request.auth.user);
    return { user: request.auth.user };
  });
  app.get('/api/avatars/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(filename)) return reply.status(404).send();
    try {
      const data = await readFile(
        join(process.env.AVATAR_UPLOAD_DIR ?? './uploads/avatars', filename),
      );
      return reply
        .header(
          'Content-Type',
          filename.endsWith('.png')
            ? 'image/png'
            : filename.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg',
        )
        .header('X-Content-Type-Options', 'nosniff')
        .send(data);
    } catch {
      return reply.status(404).send();
    }
  });
  return app;
}
