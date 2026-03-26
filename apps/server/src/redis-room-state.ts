import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { PublicUser, RoomId, ServerEvent } from '@chatroom/shared';

const PRESENCE_TTL_SECONDS = 90;
type Envelope = { origin: string; room: RoomId; event: ServerEvent };

export class RedisRoomState {
  readonly instanceId = randomUUID();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private listener?: (room: RoomId, event: ServerEvent) => void;

  constructor(url: string) {
    this.publisher = new Redis(url);
    this.subscriber = new Redis(url);
  }
  async connect(listener: (room: RoomId, event: ServerEvent) => void) {
    this.listener = listener;
    await this.subscriber.subscribe('chatroom:events');
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const envelope = JSON.parse(raw) as Envelope;
        if (envelope.origin !== this.instanceId) this.listener?.(envelope.room, envelope.event);
      } catch {
        // Ignore malformed external Pub/Sub traffic; never take down room delivery.
      }
    });
  }
  async join(room: RoomId, sessionId: string, user: PublicUser, capacity = 30) {
    const key = `chatroom:room:${room}:sessions`;
    const profile = `chatroom:room:${room}:session:${sessionId}`;
    const now = Date.now();
    const expiry = now + PRESENCE_TTL_SECONDS * 1000;
    const accepted = await this.publisher.eval(
      "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); if redis.call('ZSCORE', KEYS[1], ARGV[3]) then redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]); return 1 end; if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end; redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]); return 1",
      1,
      key,
      now,
      expiry,
      sessionId,
      capacity,
    );
    if (accepted !== 1) return false;
    await this.publisher.set(profile, JSON.stringify(user), 'EX', PRESENCE_TTL_SECONDS);
    return true;
  }
  async users(room: RoomId): Promise<PublicUser[]> {
    const key = `chatroom:room:${room}:sessions`;
    const now = Date.now();
    await this.publisher.zremrangebyscore(key, '-inf', now);
    const sessions = await this.publisher.zrange(key, 0, -1);
    const values = sessions.length
      ? await this.publisher.mget(sessions.map((id) => `chatroom:room:${room}:session:${id}`))
      : [];
    const missing = sessions.filter((_id, index) => !values[index]);
    if (missing.length) await this.publisher.zrem(key, ...missing);
    return values.flatMap((value) => {
      try {
        return value ? [JSON.parse(value) as PublicUser] : [];
      } catch {
        return [];
      }
    });
  }
  async refresh(room: RoomId, sessionId: string) {
    await Promise.all([
      this.publisher.zadd(
        `chatroom:room:${room}:sessions`,
        Date.now() + PRESENCE_TTL_SECONDS * 1000,
        sessionId,
      ),
      this.publisher.expire(`chatroom:room:${room}:session:${sessionId}`, PRESENCE_TTL_SECONDS),
    ]);
  }
  async leave(room: RoomId, sessionId: string) {
    await this.publisher.zrem(`chatroom:room:${room}:sessions`, sessionId);
    await this.publisher.del(`chatroom:room:${room}:session:${sessionId}`);
  }
  publish(room: RoomId, event: ServerEvent) {
    return this.publisher.publish(
      'chatroom:events',
      JSON.stringify({ origin: this.instanceId, room, event } satisfies Envelope),
    );
  }
  async close() {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
