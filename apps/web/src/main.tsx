import {
  type ChatMessage,
  type PublicUser,
  type RoomId,
  serverEventSchema,
} from '@chatroom/shared';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { decryptPrivateText, derivePrivateRoomKey, encryptPrivateText } from './private-crypto';
import './style.css';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok)
    throw new Error(
      ((await r.json().catch(() => ({}))) as { message?: string }).message ?? 'Request failed',
    );
  return r.json() as Promise<T>;
}
function useRoom(roomId: RoomId, enabled: boolean) {
  const [state, setState] = useState('idle');
  const [me, setMe] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const ws = useRef<WebSocket>();
  const stopped = useRef(false);
  const tries = useRef(0);
  useEffect(() => {
    stopped.current = !enabled;
    if (!enabled) {
      ws.current?.close();
      return;
    }
    let timer: number;
    const connect = () => {
      setState(tries.current ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      );
      ws.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'room.join', roomId }));
      socket.onmessage = (e) => {
        const p = serverEventSchema.safeParse(JSON.parse(e.data));
        if (!p.success) return;
        const x = p.data;
        if (x.type === 'connection.ready') setMe(x.user);
        if (x.type === 'room.joined') {
          setState('connected');
          setUsers(x.users);
          setMessages(x.messages);
          tries.current = 0;
        }
        if (x.type === 'users.updated') setUsers(x.users);
        if (x.type === 'profile.updated') {
          setUsers((users) => users.map((user) => (user.id === x.user.id ? x.user : user)));
          setMe((user) => (user?.id === x.user.id ? x.user : user));
        }
        if (x.type === 'message.created')
          setMessages((a) => [...a.filter((m) => m.id !== x.message.id), x.message]);
        if (x.type === 'message.updated')
          setMessages((a) => a.map((m) => (m.id === x.message.id ? x.message : m)));
        if (x.type === 'message.deleted')
          setMessages((a) =>
            a.map((m) => (m.id === x.messageId ? { ...m, text: null, deletedAt: x.deletedAt } : m)),
          );
        if (x.type === 'reaction.updated')
          setMessages((messages) =>
            messages.map((message) =>
              message.id === x.messageId ? { ...message, reactions: x.reactions } : message,
            ),
          );
        if (x.type === 'message.pinned') setPinnedId(x.messageId);
        if (x.type === 'typing.updated') setTyping(x.userIds);
        if (x.type === 'room.accessDenied') setState('access-denied');
        if (x.type === 'room.full') setState('room-full');
      };
      socket.onclose = () => {
        if (!stopped.current) {
          tries.current++;
          if (tries.current <= 5)
            timer = window.setTimeout(connect, Math.min(1000 * 2 ** tries.current, 10000));
          else setState('disconnected');
        }
      };
    };
    void api('/api/me')
      .then(connect)
      .catch(() => setState('disconnected'));
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [roomId, enabled]);
  const send = (event: object) =>
    ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(event));
  return {
    state,
    me,
    users,
    messages,
    typing,
    pinnedId,
    send,
    reconnect: () => {
      stopped.current = false;
      ws.current?.close();
    },
  };
}
function Room({ roomId }: { roomId: RoomId }) {
  const [access, setAccess] = useState(roomId === 'public');
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (roomId === 'private') void api('/api/rooms/private/access').catch(() => undefined);
  }, [roomId]);
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/rooms/private/access', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      const key = await derivePrivateRoomKey(password);
      setPassword('');
      setPrivateKey(key);
      setAccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to unlock room');
    }
  };
  if (!access)
    return (
      <main>
        <h1>???? Secret clubhouse</h1>
        <p>Enter the shared password to unlock this room???s encrypted messages.</p>
        <form onSubmit={unlock}>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button>Unlock</button>
          {error && <p role="alert">{error}</p>}
        </form>
      </main>
    );
  return (
    <Chat
      roomId={roomId}
      privateKey={privateKey}
      leave={
        roomId === 'private'
          ? async () => {
              await api('/api/rooms/private/access', { method: 'DELETE' });
              setPrivateKey(null);
              setAccess(false);
            }
          : undefined
      }
    />
  );
}
function Chat({
  roomId,
  leave,
  privateKey,
}: {
  roomId: RoomId;
  leave?: () => Promise<void>;
  privateKey: CryptoKey | null;
}) {
  const { state, me, users, messages, typing, pinnedId, send, reconnect } = useRoom(roomId, true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null);
  const touchTimer = useRef<number | undefined>(undefined);
  const longPress = useRef(false);
  const ignoreNextClick = useRef(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [decryptedTexts, setDecryptedTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (roomId !== 'private' || !privateKey) {
      setDecryptedTexts({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      messages.map(async (message) => {
        if (!message.text || message.deletedAt) return [message.id, ''] as const;
        try {
          return [message.id, await decryptPrivateText(privateKey, message.text)] as const;
        } catch {
          return [message.id, 'Unable to decrypt this message.'] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDecryptedTexts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [messages, privateKey, roomId]);
  const visibleMessages =
    roomId === 'private'
      ? messages.map((message) => ({
          ...message,
          text: message.text ? (decryptedTexts[message.id] ?? 'Decrypting message???') : null,
        }))
      : messages;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const plainText = text.trim();
    if (!plainText || plainText.length > 500 || (roomId === 'private' && !privateKey)) return;
    send({
      type: 'message.send',
      requestId: crypto.randomUUID(),
      ...(roomId === 'private'
        ? { ciphertext: await encryptPrivateText(privateKey!, plainText) }
        : { text: plainText }),
      ...(replyTo ? { parentId: replyTo.id } : {}),
    });
    setText('');
    setReplyTo(null);
  };
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? 'Guest';
  const activeMessage = visibleMessages.find((message) => message.id === activeMessageId);
  const manageableActiveMessage =
    activeMessage && activeMessage.authorId === me?.id && !activeMessage.deletedAt
      ? activeMessage
      : null;
  const editMessage = async (message: ChatMessage) => {
    const text = prompt('Edit message', message.text ?? '');
    const plainText = text?.trim();
    if (!plainText || plainText.length > 500 || (roomId === 'private' && !privateKey)) return;
    send({
      type: 'message.edit',
      messageId: message.id,
      ...(roomId === 'private'
        ? { ciphertext: await encryptPrivateText(privateKey!, plainText) }
        : { text: plainText }),
    });
  };
  return (
    <main className="chat">
      <nav className="room-toolbar" aria-label="Chat controls">
        <span
          className={`connection-indicator connection-indicator--${state}`}
          title={`Chat ${state}`}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" />
          </svg>
          <span className="sr-only">Chat connection: {state}</span>
        </span>
        <span className="brand-name" aria-label="Bloop chatroom">
          Bloop!
        </span>
        <div className="toolbar-actions">
          {manageableActiveMessage && (
            <div className="message-toolbar-actions" aria-label="Selected message actions">
              <button
                className={`icon-button ${pinnedId === manageableActiveMessage.id ? 'icon-button--active' : ''}`}
                aria-label={
                  pinnedId === manageableActiveMessage.id
                    ? 'Unpin selected message'
                    : 'Pin selected message'
                }
                title={pinnedId === manageableActiveMessage.id ? 'Unpin message' : 'Pin message'}
                onClick={() =>
                  send(
                    pinnedId === manageableActiveMessage.id
                      ? { type: 'message.unpin' }
                      : { type: 'message.pin', messageId: manageableActiveMessage.id },
                  )
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 4h8m-1 0v5l3 3v2H6v-2l3-3V4m3 10v6" />
                </svg>
              </button>
              <button
                className="icon-button"
                aria-label="Edit selected message"
                title="Edit message"
                onClick={() => void editMessage(manageableActiveMessage)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4l11-11-4-4L4 16v4zM13.5 6.5l4 4" />
                </svg>
              </button>
              <button
                className="icon-button icon-button--danger"
                aria-label="Delete selected message"
                title="Delete message"
                onClick={() => {
                  if (confirm('Delete this message?')) {
                    send({ type: 'message.delete', messageId: manageableActiveMessage.id });
                    setActiveMessageId(null);
                  }
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v5m4-5v5" />
                </svg>
              </button>
            </div>
          )}
          {leave && (
            <button
              className="icon-button"
              aria-label="Leave private room"
              title="Leave private room"
              onClick={() => void leave()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 17l5-5-5-5M15 12H3m10-8h6a2 2 0 012 2v12a2 2 0 01-2 2h-6" />
              </svg>
            </button>
          )}
          {state === 'disconnected' && (
            <button
              className="icon-button"
              aria-label="Reconnect"
              title="Reconnect"
              onClick={reconnect}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11a8 8 0 10.3 3M20 4v7h-7" />
              </svg>
            </button>
          )}
          <button
            className={`icon-button ${searchOpen ? 'icon-button--active' : ''}`}
            aria-label="Search messages"
            aria-expanded={searchOpen}
            title="Search messages"
            onClick={() => {
              setSearchOpen((open) => !open);
              setPeopleOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="M16 16l4.5 4.5" />
            </svg>
          </button>
          <button
            className={`icon-button ${peopleOpen ? 'icon-button--active' : ''}`}
            aria-label="Show online people"
            aria-expanded={peopleOpen}
            title="Online people"
            onClick={() => {
              setPeopleOpen((open) => !open);
              setSearchOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20c.7-4 3.1-6 7.5-6s6.8 2 7.5 6" />
            </svg>
          </button>
        </div>
        <section
          className={`toolbar-panel ${searchOpen ? 'toolbar-panel--open' : ''}`}
          aria-hidden={!searchOpen}
        >
          {roomId === 'private' ? (
            <p>Search is unavailable because private messages are end-to-end encrypted.</p>
          ) : (
            <>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (query.trim().length >= 2) {
                    setSearchResults(
                      (
                        await api<{ messages: ChatMessage[] }>(
                          `/api/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`,
                        )
                      ).messages,
                    );
                  }
                }}
