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
