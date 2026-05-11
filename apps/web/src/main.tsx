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
        <h1>🔒 Secret clubhouse</h1>
        <p>Enter the shared password to unlock this room’s encrypted messages.</p>
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
          text: message.text ? (decryptedTexts[message.id] ?? 'Decrypting message…') : null,
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
              >
                <label className="sr-only" htmlFor="message-search">
                  Search messages
                </label>
                <input
                  id="message-search"
                  placeholder="Search messages"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  minLength={2}
                />
                <button className="search-submit">Search</button>
              </form>
              {searchResults.length > 0 && <p>{searchResults.length} matching message(s)</p>}
            </>
          )}
        </section>
        <section
          className={`toolbar-panel people-panel ${peopleOpen ? 'toolbar-panel--open' : ''}`}
          aria-hidden={!peopleOpen}
        >
          <strong>Online now · {users.length}</strong>
          <div className="people-list">
            {users.map((u) => (
              <span key={u.id}>{u.name}</span>
            ))}
          </div>
        </section>
      </nav>
      <header>
        <h1>{roomId === 'public' ? 'Public room' : 'Private room'}</h1>
        <span aria-live="polite">
          {state === 'reconnecting' ? 'Finding the chat signal…' : state}
        </span>
        {leave && <button onClick={() => void leave()}>Leave private room</button>}{' '}
        {state === 'disconnected' && <button onClick={reconnect}>Try the chat signal again</button>}
      </header>
      <aside>
        <h2>Online ({users.length})</h2>
        {users.map((u) => (
          <div key={u.id}>{u.name}</div>
        ))}
      </aside>
      <section className="messages" aria-live="polite">
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (query.trim().length >= 2)
              setSearchResults(
                (
                  await api<{ messages: ChatMessage[] }>(
                    `/api/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`,
                  )
                ).messages,
              );
          }}
        >
          <label>
            Search messages
            <input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} />
          </label>
          <button>Search</button>
          {searchResults.length > 0 && <p>{searchResults.length} matching message(s)</p>}
        </form>
        {pinnedId && (
          <p>
            <strong>Pinned:</strong>{' '}
            {visibleMessages.find((message) => message.id === pinnedId)?.text ?? 'A pinned message'}
          </p>
        )}
        {visibleMessages.map((m) => (
          <article
            key={m.id}
            className={`message ${m.authorId === me?.id ? 'message--mine' : ''} ${activeMessageId === m.id ? 'message--active' : ''} ${reactionMessageId === m.id ? 'message--reactions' : ''}`}
            onMouseEnter={() => setReactionMessageId(m.id)}
            onMouseLeave={() => {
              setReactionMessageId(null);
            }}
            onClick={() => {
              if (ignoreNextClick.current) {
                ignoreNextClick.current = false;
                return;
              }
              setActiveMessageId((id) => (id === m.id ? null : m.id));
            }}
            onTouchStart={() => {
              longPress.current = false;
              touchTimer.current = window.setTimeout(() => {
                longPress.current = true;
                setActiveMessageId(m.id);
              }, 550);
            }}
            onTouchEnd={() => {
              clearTimeout(touchTimer.current);
              ignoreNextClick.current = true;
              if (!longPress.current) {
                setReactionMessageId((id) => (id === m.id ? null : m.id));
              }
            }}
            onTouchCancel={() => {
              clearTimeout(touchTimer.current);
              ignoreNextClick.current = true;
            }}
          >
            <strong>{name(m.authorId)}</strong>{' '}
            <time>{new Date(m.createdAt).toLocaleTimeString()}</time>
            {m.deletedAt ? (
              <em>This message wandered off.</em>
            ) : (
              <>
                {m.parentId && (
                  <small>
                    Replying to{' '}
                    {name(
                      visibleMessages.find((parent) => parent.id === m.parentId)?.authorId ?? '',
                    )}
                  </small>
                )}
                <p>{m.text}</p>
                {m.updatedAt && <small>edited</small>}
                <span className="reactions" onClick={(event) => event.stopPropagation()}>
                  {m.reactions.map((reaction) => (
                    <button
                      key={reaction.emoji}
                      onClick={() =>
                        send({ type: 'reaction.toggle', messageId: m.id, emoji: reaction.emoji })
                      }
                    >
                      {reaction.emoji} {reaction.count}
                    </button>
                  ))}
                  {['👍', '❤️', '😂', '🎉', '👀']
                    .filter((emoji) => !m.reactions.some((reaction) => reaction.emoji === emoji))
                    .map((emoji) => (
                      <button
                        key={emoji}
                        aria-label={`React ${emoji}`}
                        onClick={() => send({ type: 'reaction.toggle', messageId: m.id, emoji })}
                      >
                        {emoji}
                      </button>
                    ))}
                </span>
                <span className="message-actions" onClick={(event) => event.stopPropagation()}>
                  <button aria-label="Reply" title="Reply" onClick={() => setReplyTo(m)}>
                    ↩
                  </button>
                  {m.authorId === me?.id && (
                    <>
                      <button
                        aria-label="Edit message"
                        title="Edit"
                        onClick={() => {
                          const text = prompt('Edit message', m.text ?? '');
                          if (text) send({ type: 'message.edit', messageId: m.id, text });
                        }}
                      >
                        ✎
                      </button>
                      <button
                        aria-label="Delete message"
                        title="Delete"
                        onClick={() =>
                          confirm('Delete this message?') &&
                          send({ type: 'message.delete', messageId: m.id })
                        }
                      >
                        🗑
                      </button>
                    </>
                  )}
                </span>
              </>
            )}
          </article>
        ))}
      </section>
      <p>{typing.length ? `${typing.map(name).join(', ')} typing…` : ''}</p>
      <form className="composer" onSubmit={submit}>
        {replyTo && (
          <p>
            Replying to {name(replyTo.authorId)}{' '}
            <button type="button" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </p>
        )}
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <input
          id="message"
          maxLength={500}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            send({ type: e.target.value ? 'typing.start' : 'typing.stop' });
          }}
        />
        <button
          className="send-button"
          aria-label="Send message"
          title="Send message"
          disabled={state !== 'connected'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" />
          </svg>
        </button>
      </form>
    </main>
  );
}
function Profile() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [error, setError] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    void api<{ user: PublicUser }>('/api/me').then((x) => setMe(x.user));
  }, []);
  if (!me) return <main>Loading profile…</main>;
  return (
    <main>
      <h1>Profile</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const user = (
              await api<{ user: PublicUser }>('/api/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: me.name, bio: me.bio }),
              })
            ).user;
            setMe(user);
            nav('/public');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save');
          }
        }}
      >
        <label>
          Name
          <input
            value={me.name}
            minLength={2}
            maxLength={24}
            onChange={(e) => setMe({ ...me, name: e.target.value })}
          />
        </label>
        <label>
          Bio
          <textarea
            value={me.bio}
            maxLength={160}
            onChange={(e) => setMe({ ...me, bio: e.target.value })}
          />
        </label>
        <label>
          Avatar
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const data = new FormData();
              data.append('file', f);
              const r = await fetch('/api/me/avatar', {
                method: 'POST',
                credentials: 'include',
                body: data,
              });
              if (r.ok) setMe(((await r.json()) as { user: PublicUser }).user);
            }}
          />
        </label>
        {me.avatarUrl && (
          <>
            <img className="avatar" src={me.avatarUrl} alt="Current avatar" />
            <button
              type="button"
              onClick={async () =>
                setMe(
                  (await api<{ user: PublicUser }>('/api/me/avatar', { method: 'DELETE' })).user,
                )
              }
            >
              Remove avatar
            </button>
          </>
        )}
        <button>Save profile</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
function Admin() {
  const [secret, setSecret] = useState('');
  const [settings, setSettings] = useState<{
    publicRoomEnabled: boolean;
    privateRoomEnabled: boolean;
    roomCapacity: number;
    messageRetentionDays: number;
  } | null>(null);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ secret }) });
    setSettings(await api('/api/admin/settings'));
  };
  if (!settings)
    return (
      <main>
        <h1>Admin</h1>
        <form onSubmit={login}>
          <label>
            Admin secret
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </label>
          <button>Sign in</button>
        </form>
      </main>
    );
  return (
    <main>
      <h1>Admin settings</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSettings(
            await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
          );
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={settings.publicRoomEnabled}
            onChange={(e) => setSettings({ ...settings, publicRoomEnabled: e.target.checked })}
          />{' '}
          Public room enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.privateRoomEnabled}
            onChange={(e) => setSettings({ ...settings, privateRoomEnabled: e.target.checked })}
          />{' '}
          Private room enabled
        </label>
        <label>
          Capacity
          <input
            type="number"
            min="1"
            max="30"
            value={settings.roomCapacity}
            onChange={(e) => setSettings({ ...settings, roomCapacity: Number(e.target.value) })}
          />
        </label>
        <label>
          Retention days
          <input
            type="number"
            min="1"
            max="365"
            value={settings.messageRetentionDays}
            onChange={(e) =>
              setSettings({ ...settings, messageRetentionDays: Number(e.target.value) })
            }
          />
        </label>
        <button>Save settings</button>
      </form>
    </main>
  );
}
function App() {
  return (
    <Routes>
      <Route path="/" element={<Room roomId="public" />} />
      <Route path="/public" element={<Room roomId="public" />} />
      <Route path="/private" element={<Room roomId="private" />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
