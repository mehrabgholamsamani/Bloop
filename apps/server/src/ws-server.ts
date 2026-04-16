import {
  clientEventSchema,
  type ChatMessage,
  type RoomId,
  type ServerEvent,
} from '@chatroom/shared';
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { prisma } from './prisma.js';
import { sessionFromCookie } from './auth.js';
import { RedisRoomState } from './redis-room-state.js';
import { getSettings } from './settings.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

type Peer = {
  ws: WebSocket;
  sessionId: string;
  user: { id: string; name: string; bio: string; avatarUrl: string | null };
  room?: RoomId;
  typing?: ReturnType<typeof setTimeout>;
  isAdmin?: boolean;
};
const rooms: Record<RoomId, Set<Peer>> = { public: new Set(), private: new Set() };
const messageWindows = new Map<string, number[]>();
const send = (ws: WebSocket, event: ServerEvent) =>
  ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(event));
const message = (m: {
  id: string;
  roomId: RoomId;
  authorId: string;
  text: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
  parentId: string | null;
  reactions?: { emoji: string }[];
}): ChatMessage => ({
  ...m,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt?.toISOString() ?? null,
  deletedAt: m.deletedAt?.toISOString() ?? null,
  parentId: m.parentId,
  reactions: Object.entries(
    (m.reactions ?? []).reduce<Record<string, number>>((counts, reaction) => {
      counts[reaction.emoji] = (counts[reaction.emoji] ?? 0) + 1;
      return counts;
    }, {}),
  ).map(([emoji, count]) => ({ emoji, count })),
});
const users = (room: RoomId) =>
  [...rooms[room]].map((p) => p.user).filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i);
const localBroadcast = (room: RoomId, event: ServerEvent, omit?: WebSocket) =>
  rooms[room].forEach((p) => {
    if (p.ws !== omit) send(p.ws, event);
  });
let distributed: RedisRoomState | undefined;
const broadcast = (room: RoomId, event: ServerEvent, omit?: WebSocket) => {
  localBroadcast(room, event, omit);
  void distributed?.publish(room, event);
};
function leave(peer: Peer) {
  if (!peer.room) return;
  const room = peer.room;
  clearTimeout(peer.typing);
  peer.typing = undefined;
  rooms[room].delete(peer);
  peer.room = undefined;
  if (![...rooms[room]].some((p) => p.sessionId === peer.sessionId))
    void distributed?.leave(room, peer.sessionId);
  if (![...rooms[room]].some((p) => p.user.id === peer.user.id))
    broadcast(room, { type: 'user.left', userId: peer.user.id });
  broadcast(room, { type: 'users.updated', users: users(room) });
  broadcast(room, {
    type: 'typing.updated',
    userIds: [...rooms[room]].filter((p) => p.typing).map((p) => p.user.id),
  });
}
export function broadcastProfileUpdate(user: Peer['user']) {
  for (const room of ['public', 'private'] as const) {
    if ([...rooms[room]].some((peer) => peer.user.id === user.id)) {
      for (const peer of rooms[room]) if (peer.user.id === user.id) peer.user = user;
      broadcast(room, { type: 'profile.updated', user });
      broadcast(room, { type: 'users.updated', users: users(room) });
    }
  }
}
export async function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  if (process.env.REDIS_URL) {
    distributed = new RedisRoomState(process.env.REDIS_URL);
    await distributed.connect((room, event) => localBroadcast(room, event));
  }
  server.on('upgrade', async (request, socket, head) => {
    if (
      request.url?.split('?')[0] !== '/ws' ||
      request.headers.origin !== (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173')
    )
      return socket.destroy();
    const cookie = request.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('chatroom_session='))
      ?.slice('chatroom_session='.length);
    const session = await sessionFromCookie(cookie);
    if (!session) return socket.destroy();
    const admin = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('chatroom_admin='))
      ?.slice('chatroom_admin='.length);
    const expected = createHmac('sha256', process.env.SESSION_SECRET ?? '')
      .update(process.env.ADMIN_SECRET ?? '')
      .digest('base64url');
    const isAdmin = Boolean(
      admin &&
      admin.length === expected.length &&
      timingSafeEqual(Buffer.from(admin), Buffer.from(expected)),
    );
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) =>
      wss.emit('connection', ws, session, isAdmin),
    );
  });
  wss.on(
    'connection',
    (ws: WebSocket, session: Awaited<ReturnType<typeof sessionFromCookie>>, isAdmin: boolean) => {
      if (!session) return ws.close();
      const peer: Peer = { ws, sessionId: session.id, user: session.user, isAdmin };
      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
        if (peer.room) void distributed?.refresh(peer.room, peer.sessionId);
      }, 30_000);
      send(ws, { type: 'connection.ready', user: peer.user });
      ws.on('message', (raw: RawData) => {
        void handleMessage(raw);
      });
      async function handleMessage(raw: RawData) {
        try {
          let event;
          try {
            event = clientEventSchema.parse(JSON.parse(raw.toString()));
          } catch {
            return send(ws, { type: 'error', code: 'INVALID_EVENT', message: 'Invalid event.' });
          }
          if (event.type === 'room.join') {
            if (peer.room)
              return send(ws, {
                type: 'error',
                code: 'ALREADY_IN_ROOM',
                message: 'Leave the current room first.',
              });
            const settings = await getSettings();
            if (
              (event.roomId === 'public' && !settings.publicRoomEnabled) ||
              (event.roomId === 'private' && !settings.privateRoomEnabled)
            )
              return send(ws, { type: 'room.accessDenied', roomId: event.roomId });
            if (
              event.roomId === 'private' &&
              !(await prisma.privateRoomAccess.findFirst({
                where: { sessionId: peer.sessionId, expiresAt: { gt: new Date() } },
              }))
            )
              return send(ws, { type: 'room.accessDenied', roomId: 'private' });
            const accepted = distributed
              ? await distributed.join(
                  event.roomId,
                  peer.sessionId,
                  peer.user,
                  settings.roomCapacity,
                )
              : ![...rooms[event.roomId]].some((p) => p.sessionId === peer.sessionId) &&
                new Set([...rooms[event.roomId]].map((p) => p.sessionId)).size <
                  settings.roomCapacity;
            if (!accepted) return send(ws, { type: 'room.full', roomId: event.roomId });
            peer.room = event.roomId;
            rooms[peer.room].add(peer);
            const history = await prisma.message.findMany({
              where: { roomId: peer.room },
              orderBy: { createdAt: 'desc' },
              take: 50,
              include: { reactions: { select: { emoji: true } } },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const moderation = prisma as unknown as any;
            const ban = await moderation.moderationAction.findFirst({
              where: {
                userId: peer.user.id,
                kind: 'ban',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            });
            if (ban) return send(ws, { type: 'room.accessDenied', roomId: event.roomId });
            history.reverse();
            send(ws, {
              type: 'room.joined',
              roomId: peer.room,
              users: distributed ? await distributed.users(peer.room) : users(peer.room),
              messages: history.map(message),
            });
            const pin = await prisma.pinnedMessage.findUnique({ where: { roomId: peer.room } });
            send(ws, {
              type: 'message.pinned',
              roomId: peer.room,
              messageId: pin?.messageId ?? null,
            });
            broadcast(peer.room, { type: 'user.joined', user: peer.user }, ws);
            return broadcast(peer.room, { type: 'users.updated', users: users(peer.room) });
          }
          if (!peer.room)
            return send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first.' });
          if (event.type === 'admin.user.kick') {
            if (!peer.isAdmin)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'Admin access required.',
              });
            for (const target of rooms[peer.room])
              if (target.user.id === event.userId) target.ws.close(4001, 'Removed by an admin');
            return;
          }
          if (event.type === 'admin.message.edit' || event.type === 'admin.message.delete') {
            if (!peer.isAdmin)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'Admin access required.',
              });
            const target = await prisma.message.findFirst({
              where: { id: event.messageId, roomId: peer.room },
            });
            if (!target || target.deletedAt)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_NOT_FOUND',
                message: 'Message not found.',
              });
            if (peer.room === 'private' && event.type === 'admin.message.edit')
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'Encrypted private messages cannot be edited by an administrator.',
              });
            if (event.type === 'admin.message.edit') {
              const updated = await prisma.message.update({
                where: { id: target.id },
                data: { text: event.text, updatedAt: new Date() },
                include: { reactions: { select: { emoji: true } } },
              });
              return broadcast(peer.room, { type: 'message.updated', message: message(updated) });
            }
            const deleted = await prisma.message.update({
              where: { id: target.id },
              data: { text: null, deletedAt: new Date() },
            });
            return broadcast(peer.room, {
              type: 'message.deleted',
              messageId: deleted.id,
              deletedAt: deleted.deletedAt!.toISOString(),
            });
          }
          if (event.type === 'message.send') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const moderation = prisma as unknown as any;
            const mute = await moderation.moderationAction.findFirst({
              where: {
                userId: peer.user.id,
                kind: 'mute',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            });
            if (mute)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'You are currently muted.',
              });
            const now = Date.now();
            const previous = (messageWindows.get(peer.user.id) ?? []).filter(
              (time) => time > now - 10_000,
            );
            if (previous.length >= 8)
              return send(ws, {
                type: 'error',
                code: 'RATE_LIMITED',
                message: 'Sending messages too quickly.',
              });
            messageWindows.set(peer.user.id, [...previous, now]);
            const payload = peer.room === 'private' ? event.ciphertext : event.text;
            if (
              !payload ||
              (peer.room === 'private' && event.text !== undefined) ||
              (peer.room === 'public' && event.ciphertext !== undefined)
            )
              return send(ws, {
                type: 'error',
                code: 'INVALID_EVENT',
                message:
                  peer.room === 'private'
                    ? 'Private messages must be encrypted.'
                    : 'Invalid message.',
              });
            if (event.parentId) {
              const parent = await prisma.message.findFirst({
                where: { id: event.parentId, roomId: peer.room, deletedAt: null },
              });
              if (!parent)
                return send(ws, {
                  type: 'error',
                  code: 'MESSAGE_NOT_FOUND',
                  message: 'Reply target not found.',
                });
            }
            const created = await prisma.message.create({
              data: {
                roomId: peer.room,
                authorId: peer.user.id,
                text: payload,
                parentId: event.parentId,
              },
              include: { reactions: { select: { emoji: true } } },
            });
            return broadcast(peer.room, {
              type: 'message.created',
              message: message(created),
              requestId: event.requestId,
            });
          }
          if (event.type === 'message.edit') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const moderation = prisma as unknown as any;
            const mute = await moderation.moderationAction.findFirst({
              where: {
                userId: peer.user.id,
                kind: 'mute',
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            });
            if (mute)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'You are currently muted.',
              });
            const found = await prisma.message.findFirst({
              where: { id: event.messageId, roomId: peer.room },
            });
            if (!found)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_NOT_FOUND',
                message: 'Message not found.',
              });
            if (found.authorId !== peer.user.id)
              return send(ws, { type: 'error', code: 'FORBIDDEN', message: 'Not allowed.' });
            if (found.deletedAt)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_DELETED',
                message: 'Message was deleted.',
              });
            const payload = peer.room === 'private' ? event.ciphertext : event.text;
            if (
              !payload ||
              (peer.room === 'private' && event.text !== undefined) ||
              (peer.room === 'public' && event.ciphertext !== undefined)
            )
              return send(ws, {
                type: 'error',
                code: 'INVALID_EVENT',
                message:
                  peer.room === 'private'
                    ? 'Private messages must be encrypted.'
                    : 'Invalid message.',
              });
            const updated = await prisma.message.update({
              where: { id: found.id },
              data: { text: payload, updatedAt: new Date() },
              include: { reactions: { select: { emoji: true } } },
            });
            return broadcast(peer.room, { type: 'message.updated', message: message(updated) });
          }
          if (event.type === 'message.delete') {
            const found = await prisma.message.findFirst({
              where: { id: event.messageId, roomId: peer.room },
            });
            if (!found)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_NOT_FOUND',
                message: 'Message not found.',
              });
            if (found.authorId !== peer.user.id)
              return send(ws, { type: 'error', code: 'FORBIDDEN', message: 'Not allowed.' });
            if (found.deletedAt)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_DELETED',
                message: 'Message was deleted.',
              });
            const [deleted, pin] = await prisma.$transaction([
              prisma.message.update({
                where: { id: found.id },
                data: { text: null, deletedAt: new Date() },
              }),
              prisma.pinnedMessage.findUnique({ where: { roomId: peer.room } }),
            ]);
            if (pin?.messageId === found.id)
              await prisma.pinnedMessage.delete({ where: { roomId: peer.room } });
            broadcast(peer.room, {
              type: 'message.deleted',
              messageId: deleted.id,
              deletedAt: deleted.deletedAt!.toISOString(),
            });
            if (pin?.messageId === found.id)
              broadcast(peer.room, { type: 'message.pinned', roomId: peer.room, messageId: null });
            return;
          }
          if (event.type === 'reaction.toggle') {
            const target = await prisma.message.findFirst({
              where: { id: event.messageId, roomId: peer.room, deletedAt: null },
            });
            if (!target)
              return send(ws, {
                type: 'error',
                code: 'MESSAGE_NOT_FOUND',
                message: 'Message not found.',
              });
            await prisma.$transaction(async (tx) => {
              const existing = await tx.reaction.findUnique({
                where: {
                  messageId_userId_emoji: {
                    messageId: target.id,
                    userId: peer.user.id,
                    emoji: event.emoji,
                  },
                },
              });
              if (existing) await tx.reaction.delete({ where: { id: existing.id } });
              else
                await tx.reaction.create({
                  data: { messageId: target.id, userId: peer.user.id, emoji: event.emoji },
                });
            });
            const reactions = await prisma.reaction.groupBy({
              by: ['emoji'],
              where: { messageId: target.id },
              _count: { emoji: true },
            });
            return broadcast(peer.room, {
              type: 'reaction.updated',
              messageId: target.id,
              reactions: reactions.map((reaction) => ({
                emoji: reaction.emoji,
                count: reaction._count.emoji,
              })),
            });
          }
          if (event.type === 'message.pin') {
            const target = await prisma.message.findFirst({
              where: {
                id: event.messageId,
                roomId: peer.room,
                authorId: peer.user.id,
                deletedAt: null,
              },
            });
            if (!target)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'Only your active messages can be pinned.',
              });
            await prisma.pinnedMessage.upsert({
              where: { roomId: peer.room },
              create: { roomId: peer.room, messageId: target.id, pinnedBy: peer.user.id },
              update: { messageId: target.id, pinnedBy: peer.user.id },
            });
            return broadcast(peer.room, {
              type: 'message.pinned',
              roomId: peer.room,
              messageId: target.id,
            });
          }
          if (event.type === 'message.unpin') {
            const pin = await prisma.pinnedMessage.findUnique({ where: { roomId: peer.room } });
            if (!pin || pin.pinnedBy !== peer.user.id)
              return send(ws, {
                type: 'error',
                code: 'FORBIDDEN',
                message: 'Only the user who pinned it can unpin it.',
              });
            await prisma.pinnedMessage.delete({ where: { roomId: peer.room } });
            return broadcast(peer.room, {
              type: 'message.pinned',
              roomId: peer.room,
              messageId: null,
            });
          }
          if (event.type.startsWith('typing')) {
            if (event.type === 'typing.stop') {
              clearTimeout(peer.typing);
              peer.typing = undefined;
            } else {
              clearTimeout(peer.typing);
              peer.typing = setTimeout(() => {
                peer.typing = undefined;
                if (peer.room)
                  broadcast(peer.room, {
                    type: 'typing.updated',
                    userIds: [...rooms[peer.room]].filter((p) => p.typing).map((p) => p.user.id),
                  });
              }, 3000);
            }
            return broadcast(
              peer.room,
              {
                type: 'typing.updated',
                userIds: [...rooms[peer.room]].filter((p) => p.typing).map((p) => p.user.id),
              },
              ws,
            );
          }
        } catch {
          send(ws, {
            type: 'error',
            code: 'INTERNAL_ERROR',
            message: 'Unable to process that event.',
          });
        }
      }
      ws.on('close', () => {
        clearInterval(heartbeat);
        clearTimeout(peer.typing);
        leave(peer);
      });
    },
  );
  return {
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await distributed?.close();
    },
  };
}
