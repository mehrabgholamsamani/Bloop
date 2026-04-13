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
