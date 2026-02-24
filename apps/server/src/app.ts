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
        .send({ code: 'VALIDATION_ERROR', message: 'A 3???300 character reason is required.' });
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
