import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

const COOKIE_NAME = 'chatroom_session';
const SESSION_DAYS = 30;
const RENEWAL_DAYS = 7;

export type AuthenticatedSession = {
  id: string;
  user: { id: string; name: string; bio: string; avatarUrl: string | null };
  expiresAt: Date;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedSession;
  }
}

function secret() {
  return process.env.SESSION_SECRET ?? 'development-only-secret-change-me';
}
function sign(token: string) {
  return createHmac('sha256', secret()).update(token).digest('base64url');
}
function hasValidSignature(token: string, signature: string) {
  const expected = Buffer.from(sign(token));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
function publicUser(user: { id: string; name: string; bio: string; avatarUrl: string | null }) {
  return { id: user.id, name: user.name, bio: user.bio, avatarUrl: user.avatarUrl };
}

export async function resolveSession(request: FastifyRequest, reply: FastifyReply) {
  const rawCookie = request.cookies[COOKIE_NAME];
  const session = await sessionFromCookie(request.cookies[COOKIE_NAME]);
  if (session) {
    if (session.expiresAt.getTime() - Date.now() < RENEWAL_DAYS * 86_400_000) {
      session.expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: session.expiresAt },
      });
      reply.setCookie(COOKIE_NAME, rawCookie!, cookieOptions());
    }
    request.auth = session;
    return;
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const user = await prisma.user.create({
    data: { name: `Guest-${randomBytes(2).toString('hex').toUpperCase()}` },
  });
  const record = await prisma.session.create({
    data: { tokenHash: tokenHash(token), userId: user.id, expiresAt },
  });
  request.auth = { id: record.id, user: publicUser(user), expiresAt };
  reply.setCookie(COOKIE_NAME, `${token}.${sign(token)}`, cookieOptions());
}

export async function sessionFromCookie(
  cookie: string | undefined,
): Promise<AuthenticatedSession | null> {
  const [token, signature] = cookie?.split('.') ?? [];
  if (token && signature && hasValidSignature(token, signature)) {
    const record = await prisma.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (record && record.expiresAt > new Date()) {
      return { id: record.id, user: publicUser(record.user), expiresAt: record.expiresAt };
    }
  }
  return null;
}
