import {
  type ChatMessage,
  type PublicUser,
  type RoomId,
  serverEventSchema,
} from '@chatroom/shared';
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { decryptPrivateText, derivePrivateRoomKey, encryptPrivateText } from './private-crypto';
import './style.css';

type IconName =
  | 'arrow-down'
  | 'arrow-left'
  | 'check'
  | 'chevron-right'
  | 'close'
  | 'edit'
  | 'lock'
  | 'moon'
  | 'palette'
  | 'people'
  | 'pin'
  | 'reply'
  | 'search'
  | 'send'
  | 'settings'
  | 'sun'
  | 'trash'
  | 'unlock'
  | 'user';

const iconPaths: Record<IconName, React.ReactNode> = {
  'arrow-down': <path d="M12 5v14m-6-6 6 6 6-6" />,
  'arrow-left': <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  moon: <path d="M20 15.2A8.4 8.4 0 0 1 8.8 4 8.4 8.4 0 1 0 20 15.2Z" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18h1.4a1.6 1.6 0 0 0 1.2-2.7 1.6 1.6 0 0 1 1.2-2.7H17a4 4 0 0 0 4-4C21 6.9 17 3 12 3Z" />
      <circle cx="7.5" cy="11.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r=".7" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.5" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  people: (
    <>
      <path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M17 11a4 4 0 0 1 4 4v2" />
    </>
  ),
  pin: <path d="M8 4h8m-1 0v5l3 3v2H6v-2l3-3V4m3 10v6" />,
  reply: <path d="m9 17-5-5 5-5m-5 5h9a7 7 0 0 1 7 7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  send: <path d="M21 3 10 14m11-11-7 18-4-7-7-4 18-7Z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />,
  unlock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 7-2.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c.7-4.6 3.2-7 7.5-7s6.8 2.4 7.5 7" />
    </>
  ),
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function Avatar({
  user,
  size = 'medium',
}: {
  user?: PublicUser | null;
  size?: 'small' | 'medium' | 'large';
}) {
  return user?.avatarUrl ? (
    <img className={`avatar avatar--${size}`} src={user.avatarUrl} alt="" />
  ) : (
    <span className={`avatar avatar--${size} avatar--fallback`} aria-hidden="true">
      {initials(user?.name ?? 'Guest')}
    </span>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Something went wrong. Please try again.');
  }
  return response.json() as Promise<T>;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('bloop-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bloop-theme', theme);
  }, [theme]);
  return { theme, toggleTheme: () => setTheme((value) => (value === 'light' ? 'dark' : 'light')) };
}

type AccentColor = 'blue' | 'violet' | 'rose' | 'tangerine' | 'sage';
type BackgroundTemplate = 'atmosphere' | 'aurora' | 'sunset' | 'cloud' | 'linen';
type ConversationDensity = 'comfortable' | 'compact';
type BubbleStyle = 'soft' | 'round' | 'flat';

type AppearanceSettings = {
  accent: AccentColor;
  background: BackgroundTemplate;
  density: ConversationDensity;
  bubbles: BubbleStyle;
};

const defaultAppearance: AppearanceSettings = {
  accent: 'blue',
  background: 'atmosphere',
  density: 'comfortable',
  bubbles: 'soft',
};

function readAppearance(): AppearanceSettings {
  try {
    const value = JSON.parse(
      localStorage.getItem('bloop-appearance') ?? '{}',
    ) as Partial<AppearanceSettings>;
    return {
      accent: ['blue', 'violet', 'rose', 'tangerine', 'sage'].includes(value.accent ?? '')
        ? (value.accent as AccentColor)
        : defaultAppearance.accent,
      background: ['atmosphere', 'aurora', 'sunset', 'cloud', 'linen'].includes(
        value.background ?? '',
      )
        ? (value.background as BackgroundTemplate)
        : defaultAppearance.background,
      density: ['comfortable', 'compact'].includes(value.density ?? '')
        ? (value.density as ConversationDensity)
        : defaultAppearance.density,
      bubbles: ['soft', 'round', 'flat'].includes(value.bubbles ?? '')
        ? (value.bubbles as BubbleStyle)
        : defaultAppearance.bubbles,
    };
  } catch {
    return defaultAppearance;
  }
}

function useCustomization() {
  const [settings, setSettings] = useState<AppearanceSettings>(readAppearance);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = settings.accent;
    root.dataset.background = settings.background;
    root.dataset.density = settings.density;
    root.dataset.bubbles = settings.bubbles;
    localStorage.setItem('bloop-appearance', JSON.stringify(settings));
  }, [settings]);
  return {
    settings,
    update: (next: Partial<AppearanceSettings>) =>
      setSettings((current) => ({ ...current, ...next })),
    reset: () => setSettings(defaultAppearance),
  };
}

function ThemeButton({ theme, toggleTheme }: ReturnType<typeof useTheme>) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} appearance`}
      title={`Use ${theme === 'light' ? 'dark' : 'light'} appearance`}
      onClick={toggleTheme}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
    </button>
  );
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
      socket.onmessage = (event) => {
        const parsed = serverEventSchema.safeParse(JSON.parse(event.data));
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'connection.ready') setMe(message.user);
        if (message.type === 'room.joined') {
          setState('connected');
          setUsers(message.users);
          setMessages(message.messages);
          tries.current = 0;
        }
        if (message.type === 'users.updated') setUsers(message.users);
        if (message.type === 'profile.updated') {
          setUsers((current) =>
            current.map((user) => (user.id === message.user.id ? message.user : user)),
          );
          setMe((user) => (user?.id === message.user.id ? message.user : user));
        }
        if (message.type === 'message.created')
          setMessages((current) => [
            ...current.filter((item) => item.id !== message.message.id),
            message.message,
          ]);
        if (message.type === 'message.updated')
          setMessages((current) =>
            current.map((item) => (item.id === message.message.id ? message.message : item)),
          );
        if (message.type === 'message.deleted')
          setMessages((current) =>
            current.map((item) =>
              item.id === message.messageId
                ? { ...item, text: null, deletedAt: message.deletedAt }
                : item,
            ),
          );
        if (message.type === 'reaction.updated')
          setMessages((current) =>
            current.map((item) =>
              item.id === message.messageId ? { ...item, reactions: message.reactions } : item,
            ),
          );
        if (message.type === 'message.pinned') setPinnedId(message.messageId);
        if (message.type === 'typing.updated') setTyping(message.userIds);
        if (message.type === 'room.accessDenied') setState('access-denied');
        if (message.type === 'room.full') setState('room-full');
      };
      socket.onclose = () => {
        if (stopped.current) return;
        tries.current += 1;
        if (tries.current <= 5) {
          timer = window.setTimeout(connect, Math.min(1000 * 2 ** tries.current, 10000));
        } else {
          setState('disconnected');
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

  const send = (event: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(event));
  };

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
      tries.current = 0;
      ws.current?.close();
    },
  };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/public" aria-label="Bloop public room">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && <span>Bloop</span>}
    </Link>
  );
}

function Room({ roomId }: { roomId: RoomId }) {
  const [access, setAccess] = useState(roomId === 'public');
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    if (roomId === 'private') void api('/api/rooms/private/access').catch(() => undefined);
  }, [roomId]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      await api('/api/rooms/private/access', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setPrivateKey(await derivePrivateRoomKey(password));
      setPassword('');
      setAccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to unlock this room.');
    } finally {
      setWorking(false);
    }
  };

  if (!access) {
    return (
      <div className="page-shell">
        <nav className="minimal-nav">
          <Brand />
          <ThemeButton {...theme} />
        </nav>
        <main className="auth-card material material--heavy">
          <div className="feature-icon">
            <Icon name="lock" size={26} />
          </div>
          <p className="eyebrow">Private space</p>
          <h1>Enter the quiet room.</h1>
          <p className="lede">
            Messages here are encrypted in your browser. Enter the shared room password to decrypt
            the conversation.
          </p>
          <form className="stack-form" onSubmit={unlock}>
            <label htmlFor="private-password">Room password</label>
            <div className="field-with-icon">
              <Icon name="lock" size={18} />
              <input
                id="private-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter shared password"
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            {error && (
              <p className="inline-alert" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={working}>
              <Icon name="unlock" size={18} /> {working ? 'Unlocking…' : 'Unlock room'}
            </button>
          </form>
          <Link className="text-link" to="/public">
            <Icon name="arrow-left" size={16} /> Back to the public room
          </Link>
        </main>
      </div>
    );
  }

  return (
    <Chat
      roomId={roomId}
      privateKey={privateKey}
      theme={theme}
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
}

function sameGroup(a?: ChatMessage, b?: ChatMessage) {
  if (!a || !b || a.authorId !== b.authorId || a.deletedAt || b.deletedAt) return false;
  return Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < 5 * 60_000;
}

function Chat({
  roomId,
  leave,
  privateKey,
  theme,
}: {
  roomId: RoomId;
  leave?: () => Promise<void>;
  privateKey: CryptoKey | null;
  theme: ReturnType<typeof useTheme>;
}) {
  const { state, me, users, messages, typing, pinnedId, send, reconnect } = useRoom(roomId, true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [panel, setPanel] = useState<'search' | 'people' | 'profile' | null>(null);
  const [decryptedTexts, setDecryptedTexts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const inspector = useRef<HTMLElement>(null);
  const sheetDrag = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    offset: number;
  } | null>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const previousMessageCount = useRef(0);
  const nearLatest = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageNodes = useRef<Record<string, HTMLElement | null>>({});
  const touchTimer = useRef<number | undefined>(undefined);
  const longPress = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

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

  const visibleMessages = useMemo(
    () =>
      roomId === 'private'
        ? messages.map((message) => ({
            ...message,
            text: message.text ? (decryptedTexts[message.id] ?? 'Decrypting message…') : null,
          }))
        : messages,
    [decryptedTexts, messages, roomId],
  );

  useEffect(() => {
    const previousCount = previousMessageCount.current;
    const added = Math.max(messages.length - previousCount, 0);
    const latestMessage = messages.at(-1);
    const initialLoad = previousCount === 0;
    const sentByMe = latestMessage?.authorId === me?.id;

    if (added > 0 && (initialLoad || nearLatest.current || sentByMe)) {
      requestAnimationFrame(() => {
        messagesEnd.current?.scrollIntoView({ behavior: initialLoad ? 'auto' : 'smooth' });
        nearLatest.current = true;
        setUnreadCount(0);
      });
    } else if (added > 0) {
      setUnreadCount((count) => count + added);
    }

    previousMessageCount.current = messages.length;
  }, [me?.id, messages]);

  const scrollToLatest = () => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    nearLatest.current = true;
    setUnreadCount(0);
  };

  useLayoutEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = '0px';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 144)}px`;
  }, [text]);

  const userById = (id: string) => users.find((user) => user.id === id);
  const name = (id: string) => userById(id)?.name ?? 'Guest';
  const pinnedMessage = visibleMessages.find((message) => message.id === pinnedId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const plainText = text.trim();
    if (
      !plainText ||
      plainText.length > 500 ||
      state !== 'connected' ||
      (roomId === 'private' && !privateKey)
    )
      return;
    send({
      type: 'message.send',
      requestId: crypto.randomUUID(),
      ...(roomId === 'private'
        ? { ciphertext: await encryptPrivateText(privateKey!, plainText) }
        : { text: plainText }),
      ...(replyTo ? { parentId: replyTo.id } : {}),
    });
    send({ type: 'typing.stop' });
    setText('');
    setReplyTo(null);
  };

  const saveEdit = async (message: ChatMessage) => {
    const plainText = editText.trim();
    if (!plainText || plainText.length > 500 || (roomId === 'private' && !privateKey)) return;
    send({
      type: 'message.edit',
      messageId: message.id,
      ...(roomId === 'private'
        ? { ciphertext: await encryptPrivateText(privateKey!, plainText) }
        : { text: plainText }),
    });
    setEditingId(null);
    setEditText('');
    setToast('Message updated');
  };

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2 || roomId === 'private') return;
    const result = await api<{ messages: ChatMessage[] }>(
      `/api/rooms/${roomId}/messages/search?q=${encodeURIComponent(query.trim())}`,
    );
    setSearchResults(result.messages);
  };

  const jumpToMessage = (id: string) => {
    setPanel(null);
    setActiveMessageId(id);
    requestAnimationFrame(() =>
      messageNodes.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    window.setTimeout(() => setActiveMessageId(null), 1800);
  };

  const startSheetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!matchMedia('(max-width: 820px)').matches || !inspector.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sheetDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      offset: 0,
    };
    inspector.current.style.transition = 'none';
  };

  const moveSheet = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || !inspector.current) return;
    const elapsed = Math.max(event.timeStamp - drag.lastTime, 1);
    drag.velocity = ((event.clientY - drag.lastY) / elapsed) * 1000;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    const rawOffset = event.clientY - drag.startY;
    drag.offset = rawOffset < 0 ? rawOffset * 0.16 : rawOffset;
    const scale = 1 - Math.min(Math.max(drag.offset, 0) / 6000, 0.018);
    inspector.current.style.transform = `translateY(${drag.offset}px) scale(${scale})`;
  };

  const endSheetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || !inspector.current) return;
    const shouldDismiss = drag.offset > 110 || (drag.offset > 24 && drag.velocity > 520);
    const node = inspector.current;
    sheetDrag.current = null;
    node.style.removeProperty('transition');
    node.style.removeProperty('transform');
    if (shouldDismiss) setPanel(null);
  };

  return (
    <main className={`chat-shell ${panel ? 'chat-shell--panel' : ''}`}>
      <header className="room-header material">
        <Brand compact />
        <div className="room-identity">
          <div className="room-title-row">
            <h1>{roomId === 'public' ? 'Public Lounge' : 'Private Room'}</h1>
            {roomId === 'private' && <Icon name="lock" size={14} />}
          </div>
          <p>
            <span className={`status-dot status-dot--${state}`} />
            {state === 'connected'
              ? `${users.length} ${users.length === 1 ? 'person' : 'people'} here`
              : state === 'reconnecting'
                ? 'Reconnecting…'
                : state}
          </p>
        </div>
        <div className="header-presence" aria-hidden="true">
          {users.slice(0, 3).map((user) => (
            <Avatar key={user.id} user={user} size="small" />
          ))}
        </div>
        <div className="header-actions">
          <Link
            className="icon-button appearance-shortcut"
            to="/appearance"
            aria-label="Customize Bloop"
            title="Customize Bloop"
          >
            <Icon name="palette" />
          </Link>
          <button
            className={`icon-button ${panel === 'search' ? 'is-active' : ''}`}
            type="button"
            aria-label="Search messages"
            aria-expanded={panel === 'search'}
            onClick={() => setPanel((value) => (value === 'search' ? null : 'search'))}
          >
            <Icon name="search" />
          </button>
          <button
            className={`icon-button ${panel === 'people' ? 'is-active' : ''}`}
            type="button"
            aria-label="People in this room"
            aria-expanded={panel === 'people'}
            onClick={() => setPanel((value) => (value === 'people' ? null : 'people'))}
          >
            <Icon name="people" />
          </button>
          <button
            className={`profile-trigger ${panel === 'profile' ? 'is-active' : ''}`}
            type="button"
            aria-label="Open your menu"
            aria-expanded={panel === 'profile'}
            onClick={() => setPanel((value) => (value === 'profile' ? null : 'profile'))}
          >
            <Avatar user={me} size="small" />
          </button>
        </div>
      </header>

      {state === 'disconnected' && (
        <div className="connection-banner" role="status">
          <div>
            <strong>You’re offline</strong>
            <span>Messages will return when the connection does.</span>
          </div>
          <button type="button" onClick={reconnect}>
            Reconnect
          </button>
        </div>
      )}

      <div className="room-layout">
        <section className="conversation" aria-label={`${roomId} room messages`}>
          {pinnedMessage && (
            <button
              className="pinned-ribbon material"
              type="button"
              onClick={() => jumpToMessage(pinnedMessage.id)}
            >
              <span className="pinned-icon">
                <Icon name="pin" size={16} />
              </span>
              <span>
                <small>Pinned by the room</small>
                <strong>{pinnedMessage.text ?? 'Deleted message'}</strong>
              </span>
              <Icon name="chevron-right" size={17} />
            </button>
          )}

          <div
            ref={messageList}
            className="message-list"
            aria-live="polite"
            onScroll={(event) => {
              const node = event.currentTarget;
              const isNearLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
              nearLatest.current = isNearLatest;
              if (isNearLatest && unreadCount) setUnreadCount(0);
            }}
          >
            {visibleMessages.length === 0 && state === 'connected' && (
              <div className="empty-state">
                <span className="empty-bloop" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <h2>A quiet room, for now.</h2>
                <p>Say hello and give the conversation somewhere to begin.</p>
              </div>
            )}
            {visibleMessages.map((message, index) => {
              const previous = visibleMessages[index - 1];
              const next = visibleMessages[index + 1];
              const groupStart = !sameGroup(previous, message);
              const groupEnd = !sameGroup(message, next);
              const dayStart =
                !previous ||
                new Date(previous.createdAt).toDateString() !==
                  new Date(message.createdAt).toDateString();
              const mine = message.authorId === me?.id;
              const parent = visibleMessages.find((item) => item.id === message.parentId);
              const selected = activeMessageId === message.id;
              const editing = editingId === message.id;
              return (
                <div key={message.id}>
                  {dayStart && (
                    <div className="day-divider">
                      <span>{formatDay(message.createdAt)}</span>
                    </div>
                  )}
                  <article
                    ref={(node) => {
                      messageNodes.current[message.id] = node;
                    }}
                    className={`message-row ${mine ? 'message-row--mine' : ''} ${groupStart ? 'message-row--start' : ''} ${groupEnd ? 'message-row--end' : ''} ${selected ? 'is-selected' : ''}`}
                    onPointerDown={(event) => {
                      if (event.pointerType !== 'touch') return;
                      longPress.current = false;
                      touchTimer.current = window.setTimeout(() => {
                        longPress.current = true;
                        setActiveMessageId(message.id);
                        setReactionMessageId(message.id);
                      }, 480);
                    }}
                    onPointerUp={() => clearTimeout(touchTimer.current)}
                    onPointerCancel={() => clearTimeout(touchTimer.current)}
                  >
                    <div className="message-avatar">
                      {groupEnd && !mine && (
                        <Avatar user={userById(message.authorId)} size="small" />
                      )}
                    </div>
                    <div className="message-stack">
                      {groupStart && !mine && (
                        <div className="message-author">{name(message.authorId)}</div>
                      )}
                      <div className="bubble-wrap">
                        <div
                          className={`message-bubble ${message.deletedAt ? 'message-bubble--deleted' : ''}`}
                        >
                          {message.deletedAt ? (
                            <p className="deleted-copy">This message was deleted.</p>
                          ) : editing ? (
                            <form
                              className="inline-editor"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void saveEdit(message);
                              }}
                            >
                              <textarea
                                value={editText}
                                onChange={(event) => setEditText(event.target.value)}
                                maxLength={500}
                                autoFocus
                              />
                              <div>
                                <span>{editText.length}/500</span>
                                <button type="button" onClick={() => setEditingId(null)}>
                                  Cancel
                                </button>
                                <button className="inline-save">Save</button>
                              </div>
                            </form>
                          ) : (
                            <>
                              {parent && (
                                <button
                                  className="reply-quote"
                                  type="button"
                                  onClick={() => jumpToMessage(parent.id)}
                                >
                                  <strong>{name(parent.authorId)}</strong>
                                  <span>{parent.text ?? 'Deleted message'}</span>
                                </button>
                              )}
                              <p>{message.text}</p>
                              <span className="message-meta">
                                {formatTime(message.createdAt)}
                                {message.updatedAt ? ' · Edited' : ''}
                              </span>
                            </>
                          )}
                        </div>
                        {!message.deletedAt && !editing && (
                          <div className={`message-actions ${selected ? 'is-visible' : ''}`}>
                            <button
                              type="button"
                              aria-label="Reply"
                              title="Reply"
                              onClick={() => {
                                setReplyTo(message);
                                textarea.current?.focus();
                              }}
                            >
                              <Icon name="reply" size={17} />
                            </button>
                            <button
                              type="button"
                              aria-label="Add a reaction"
                              title="React"
                              onClick={() =>
                                setReactionMessageId((id) =>
                                  id === message.id ? null : message.id,
                                )
                              }
                            >
                              ☺
                            </button>
                            {mine && (
                              <button
                                type="button"
                                aria-label="Edit message"
                                title="Edit"
                                onClick={() => {
                                  setEditingId(message.id);
                                  setEditText(message.text ?? '');
                                }}
                              >
                                <Icon name="edit" size={17} />
                              </button>
                            )}
                            {mine && (
                              <button
                                className="danger-action"
                                type="button"
                                aria-label="Delete message"
                                title="Delete"
                                onClick={() => setDeleteTarget(message)}
                              >
                                <Icon name="trash" size={17} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {!message.deletedAt && (
                        <div
                          className={`reaction-row ${reactionMessageId === message.id ? 'is-open' : ''}`}
                        >
                          {message.reactions.map((reaction) => (
                            <button
                              className="reaction-chip is-used"
                              type="button"
                              key={reaction.emoji}
                              onClick={() =>
                                send({
                                  type: 'reaction.toggle',
                                  messageId: message.id,
                                  emoji: reaction.emoji,
                                })
                              }
                            >
                              {reaction.emoji}
                              <span>{reaction.count}</span>
                            </button>
                          ))}
                          {['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F389}', '\u{1F440}']
                            .filter(
                              (emoji) =>
                                !message.reactions.some((reaction) => reaction.emoji === emoji),
                            )
                            .map((emoji) => (
                              <button
                                className="reaction-chip"
                                type="button"
                                key={emoji}
                                aria-label={`React ${emoji}`}
                                onClick={() => {
                                  send({ type: 'reaction.toggle', messageId: message.id, emoji });
                                  setReactionMessageId(null);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </article>
                </div>
              );
            })}
            <div ref={messagesEnd} />
          </div>

          <button
            className={`jump-to-latest material ${unreadCount ? 'is-visible' : ''}`}
            type="button"
            aria-label={
              unreadCount === 1 ? 'Jump to 1 new message' : `Jump to ${unreadCount} new messages`
            }
            onClick={scrollToLatest}
          >
            <Icon name="arrow-down" size={17} />
            <span>{unreadCount === 1 ? '1 new message' : `${unreadCount} new messages`}</span>
          </button>

          <div className="composer-dock">
            <div className="typing-line" aria-live="polite">
              {typing.length > 0 && (
                <>
                  <span className="typing-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  {typing.map(name).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing
                </>
              )}
            </div>
            <form
              className={`composer material ${text ? 'composer--active' : ''}`}
              onSubmit={submit}
            >
              {replyTo && (
                <div className="composer-context">
                  <span>
                    <Icon name="reply" size={16} />
                    <span>
                      <small>Replying to {name(replyTo.authorId)}</small>
                      <strong>{replyTo.text}</strong>
                    </span>
                  </span>
                  <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                    <Icon name="close" size={17} />
                  </button>
                </div>
              )}
              <div className="composer-main">
                <textarea
                  ref={textarea}
                  id="message"
                  aria-label="Message the room"
                  placeholder="Message the room"
                  rows={1}
                  maxLength={500}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    send({ type: event.target.value ? 'typing.start' : 'typing.stop' });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setReplyTo(null);
                      setText('');
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                {text.length > 440 && <span className="character-count">{500 - text.length}</span>}
                <button
                  className="send-button"
                  aria-label="Send message"
                  title="Send message"
                  disabled={!text.trim() || state !== 'connected'}
                >
                  <Icon name="send" size={19} />
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside
          ref={inspector}
          className={`inspector material material--heavy ${panel ? 'is-open' : ''}`}
          aria-hidden={!panel}
        >
          <div
            className="inspector-handle"
            role="presentation"
            onPointerDown={startSheetDrag}
            onPointerMove={moveSheet}
            onPointerUp={endSheetDrag}
            onPointerCancel={endSheetDrag}
          />
          <div className="inspector-header">
            <div>
              <p className="eyebrow">Bloop</p>
              <h2>
                {panel === 'search' ? 'Search' : panel === 'people' ? 'People' : 'Your space'}
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close panel"
              onClick={() => setPanel(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          {panel === 'search' && (
            <div className="inspector-body">
              {roomId === 'private' ? (
                <div className="panel-note">
                  <Icon name="lock" />
                  <h3>Search stays private</h3>
                  <p>Encrypted messages cannot be searched by the server.</p>
                </div>
              ) : (
                <>
                  <form className="search-field" onSubmit={runSearch}>
                    <Icon name="search" size={18} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search messages"
                      minLength={2}
                      autoFocus
                    />
                    <button aria-label="Run search">
                      <Icon name="arrow-left" size={17} />
                    </button>
                  </form>
                  <p className="result-count">
                    {searchResults.length
                      ? `${searchResults.length} ${searchResults.length === 1 ? 'result' : 'results'}`
                      : query.length >= 2
                        ? 'Press Enter to search'
                        : 'Type at least two characters'}
                  </p>
                  <div className="search-results">
                    {searchResults.map((result) => (
                      <button
                        type="button"
                        key={result.id}
                        onClick={() => jumpToMessage(result.id)}
                      >
                        <Avatar user={userById(result.authorId)} size="small" />
                        <span>
                          <strong>{name(result.authorId)}</strong>
                          <p>{result.text}</p>
                          <small>
                            {formatDay(result.createdAt)} · {formatTime(result.createdAt)}
                          </small>
                        </span>
                        <Icon name="chevron-right" size={16} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {panel === 'people' && (
            <div className="inspector-body">
              <p className="panel-description">
                {users.length} {users.length === 1 ? 'person is' : 'people are'} in the room right
                now.
              </p>
              <div className="member-list">
                {users.map((user) => (
                  <div className="member" key={user.id}>
                    <Avatar user={user} />
                    <span>
                      <strong>
                        {user.name}
                        {user.id === me?.id ? ' (you)' : ''}
                      </strong>
                      <small>{user.bio || 'Here now'}</small>
                    </span>
                    <i className="presence-dot" aria-label="Online" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {panel === 'profile' && (
            <div className="inspector-body profile-menu">
              <div className="profile-summary">
                <Avatar user={me} size="large" />
                <h3>{me?.name ?? 'Guest'}</h3>
                <p>{me?.bio || 'Make this space yours.'}</p>
              </div>
              <Link to="/profile">
                <Icon name="user" />
                <span>
                  <strong>Edit profile</strong>
                  <small>Name, bio, and photo</small>
                </span>
                <Icon name="chevron-right" size={17} />
              </Link>
              <Link to="/appearance">
                <Icon name="palette" />
                <span>
                  <strong>Customize Bloop</strong>
                  <small>Color, background, and messages</small>
                </span>
                <Icon name="chevron-right" size={17} />
              </Link>
              <Link to={roomId === 'public' ? '/private' : '/public'}>
                <Icon name={roomId === 'public' ? 'lock' : 'people'} />
                <span>
                  <strong>{roomId === 'public' ? 'Private Room' : 'Public Lounge'}</strong>
                  <small>Switch conversations</small>
                </span>
                <Icon name="chevron-right" size={17} />
              </Link>
              <button type="button" onClick={theme.toggleTheme}>
                <Icon name={theme.theme === 'light' ? 'moon' : 'sun'} />
                <span>
                  <strong>
                    {theme.theme === 'light' ? 'Dark appearance' : 'Light appearance'}
                  </strong>
                  <small>Change how Bloop looks</small>
                </span>
                <Icon name="chevron-right" size={17} />
              </button>
              {leave && (
                <button className="leave-button" type="button" onClick={() => void leave()}>
                  <Icon name="unlock" />
                  <span>
                    <strong>Leave private room</strong>
                    <small>Forget the encryption key</small>
                  </span>
                  <Icon name="chevron-right" size={17} />
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      {panel && (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="Close panel"
          onClick={() => setPanel(null)}
        />
      )}
      {deleteTarget && (
        <div
          className="dialog-layer"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setDeleteTarget(null);
          }}
        >
          <section
            className="confirm-dialog material material--heavy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="danger-icon">
              <Icon name="trash" />
            </div>
            <h2 id="delete-title">Delete this message?</h2>
            <p>It will disappear for everyone in the room. This can’t be undone.</p>
            <blockquote>{deleteTarget.text}</blockquote>
            <div>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="destructive-button"
                type="button"
                onClick={() => {
                  send({ type: 'message.delete', messageId: deleteTarget.id });
                  setDeleteTarget(null);
                  setToast('Message deleted');
                }}
              >
                Delete message
              </button>
            </div>
          </section>
        </div>
      )}
      <div className={`toast ${toast ? 'is-visible' : ''}`} role="status">
        <Icon name="check" size={17} />
        {toast}
      </div>
    </main>
  );
}

function PageHeader({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <nav className="minimal-nav">
      <Brand />
      <div>
        <ThemeButton {...theme} />
        <Link className="icon-button" to="/public" aria-label="Back to chat">
          <Icon name="close" />
        </Link>
      </div>
    </nav>
  );
}

function Profile() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const theme = useTheme();
  useEffect(() => {
    void api<{ user: PublicUser }>('/api/me').then((result) => setMe(result.user));
  }, []);

  if (!me)
    return (
      <div className="page-shell">
        <PageHeader theme={theme} />
        <main className="settings-card material">
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
          <div className="skeleton" />
        </main>
      </div>
    );

  return (
    <div className="page-shell">
      <PageHeader theme={theme} />
      <main className="settings-card material material--heavy">
        <div className="settings-heading">
          <p className="eyebrow">Your space</p>
          <h1>Profile</h1>
          <p>Choose how you appear to people across Bloop.</p>
        </div>
        <form
          className="profile-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            try {
              const result = await api<{ user: PublicUser }>('/api/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: me.name, bio: me.bio }),
              });
              setMe(result.user);
              setSaved(true);
              window.setTimeout(() => nav('/public'), 650);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not save your profile.');
            }
          }}
        >
          <section className="avatar-editor">
            <Avatar user={me} size="large" />
            <div>
              <h2>Your photo</h2>
              <p>JPG, PNG, or WebP. A square image works best.</p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? 'Uploading…' : me.avatarUrl ? 'Change photo' : 'Choose photo'}
                </button>
                {me.avatarUrl && (
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={async () =>
                      setMe(
                        (await api<{ user: PublicUser }>('/api/me/avatar', { method: 'DELETE' }))
                          .user,
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setUploading(true);
                const data = new FormData();
                data.append('file', file);
                const response = await fetch('/api/me/avatar', {
                  method: 'POST',
                  credentials: 'include',
                  body: data,
                });
                if (response.ok) setMe(((await response.json()) as { user: PublicUser }).user);
                else setError('Could not upload that image.');
                setUploading(false);
              }}
            />
          </section>
          <div className="form-section">
            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={me.name}
              minLength={2}
              maxLength={24}
              onChange={(event) => setMe({ ...me, name: event.target.value })}
            />
            <small>{me.name.length}/24</small>
          </div>
          <div className="form-section">
            <label htmlFor="profile-bio">Bio</label>
            <textarea
              id="profile-bio"
              value={me.bio}
              maxLength={160}
              rows={3}
              placeholder="A little something about you"
              onChange={(event) => setMe({ ...me, bio: event.target.value })}
            />
            <small>{me.bio.length}/160</small>
          </div>
          {error && (
            <p className="inline-alert" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Link className="secondary-button" to="/public">
              Cancel
            </Link>
            <button className="primary-button" disabled={saved}>
              <Icon name={saved ? 'check' : 'user'} size={18} />
              {saved ? 'Saved' : 'Save profile'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

const accentOptions: { value: AccentColor; label: string }[] = [
  { value: 'blue', label: 'Bloop Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'rose', label: 'Rose' },
  { value: 'tangerine', label: 'Tangerine' },
  { value: 'sage', label: 'Sage' },
];

const backgroundOptions: { value: BackgroundTemplate; label: string; description: string }[] = [
  { value: 'atmosphere', label: 'Atmosphere', description: 'Cool and airy' },
  { value: 'aurora', label: 'Aurora', description: 'Calm color flow' },
  { value: 'sunset', label: 'Sunset', description: 'Soft and warm' },
  { value: 'cloud', label: 'Cloud', description: 'Bright and minimal' },
  { value: 'linen', label: 'Linen', description: 'Quiet texture' },
];

function Appearance({ appearance }: { appearance: ReturnType<typeof useCustomization> }) {
  const theme = useTheme();
  const { settings, update, reset } = appearance;
  return (
    <div className="page-shell appearance-page">
      <PageHeader theme={theme} />
      <main className="settings-card appearance-card material material--heavy">
        <div className="settings-heading appearance-heading">
          <div>
            <p className="eyebrow">Make it yours</p>
            <h1>Appearance</h1>
            <p>Personalize Bloop on this device. Your choices update as you make them.</p>
          </div>
          <button className="secondary-button" type="button" onClick={reset}>
            Reset to default
          </button>
        </div>

        <div className="appearance-layout">
          <div className="customization-controls">
            <section className="customization-section">
              <div className="section-heading">
                <h2>Accent color</h2>
                <p>Used for actions, highlights, and your messages.</p>
              </div>
              <div className="accent-options" role="radiogroup" aria-label="Accent color">
                {accentOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`accent-option accent-option--${option.value} ${settings.accent === option.value ? 'is-selected' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={settings.accent === option.value}
                    onClick={() => update({ accent: option.value })}
                  >
                    <span className="accent-swatch">
                      {settings.accent === option.value && <Icon name="check" size={16} />}
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="customization-section">
              <div className="section-heading">
                <h2>Background</h2>
                <p>Choose the atmosphere behind your conversations.</p>
              </div>
              <div className="background-options" role="radiogroup" aria-label="Chat background">
                {backgroundOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`background-option ${settings.background === option.value ? 'is-selected' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={settings.background === option.value}
                    onClick={() => update({ background: option.value })}
                  >
                    <span className={`background-preview background-preview--${option.value}`}>
                      {settings.background === option.value && (
                        <span className="selection-check">
                          <Icon name="check" size={15} />
                        </span>
                      )}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="customization-section conversation-options">
              <div className="section-heading">
                <h2>Conversation</h2>
                <p>Tune the amount of space and shape of messages.</p>
              </div>
              <div className="preference-row">
                <span>
                  <strong>Message spacing</strong>
                  <small>How much room messages have to breathe.</small>
                </span>
                <div className="segmented-control" role="radiogroup" aria-label="Message spacing">
                  {(['comfortable', 'compact'] as const).map((density) => (
                    <button
                      key={density}
                      type="button"
                      role="radio"
                      aria-checked={settings.density === density}
                      className={settings.density === density ? 'is-selected' : ''}
                      onClick={() => update({ density })}
                    >
                      {density === 'comfortable' ? 'Roomy' : 'Compact'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preference-row">
                <span>
                  <strong>Bubble shape</strong>
                  <small>Change the character of each message.</small>
                </span>
                <div
                  className="segmented-control"
                  role="radiogroup"
                  aria-label="Message bubble shape"
                >
                  {(['soft', 'round', 'flat'] as const).map((bubbles) => (
                    <button
                      key={bubbles}
                      type="button"
                      role="radio"
                      aria-checked={settings.bubbles === bubbles}
                      className={settings.bubbles === bubbles ? 'is-selected' : ''}
                      onClick={() => update({ bubbles })}
                    >
                      {bubbles === 'soft' ? 'Soft' : bubbles === 'round' ? 'Round' : 'Flat'}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="appearance-preview-card" aria-label="Live appearance preview">
            <div className="preview-label">
              <span>Live preview</span>
              <i />
            </div>
            <div className={`chat-preview chat-preview--${settings.background}`}>
              <div className="preview-header">
                <span className="brand-mark">
                  <span />
                  <span />
                  <span />
                </span>
                <span>
                  <strong>Public Lounge</strong>
                  <small>3 people here</small>
                </span>
              </div>
              <div className="preview-conversation">
                <div className="preview-message preview-message--incoming">
                  <small>Maya</small>
                  <p>This feels more like me.</p>
                </div>
                <div className="preview-message preview-message--mine">
                  <p>Exactly the vibe I wanted ✨</p>
                </div>
                <div className="preview-reaction">
                  ♥ <span>2</span>
                </div>
              </div>
              <div className="preview-composer">
                <span>Message the room</span>
                <i>
                  <Icon name="send" size={14} />
                </i>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true">
        <span />
      </i>
    </label>
  );
}

function Admin() {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<{
    publicRoomEnabled: boolean;
    privateRoomEnabled: boolean;
    roomCapacity: number;
    messageRetentionDays: number;
  } | null>(null);
  const theme = useTheme();
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ secret }) });
      setSettings(await api('/api/admin/settings'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.');
    }
  };

  return (
    <div className="page-shell">
      <PageHeader theme={theme} />
      {!settings ? (
        <main className="auth-card material material--heavy">
          <div className="feature-icon">
            <Icon name="settings" size={26} />
          </div>
          <p className="eyebrow">Bloop controls</p>
          <h1>Administration</h1>
          <p className="lede">
            Sign in to manage room availability, capacity, and message retention.
          </p>
          <form className="stack-form" onSubmit={login}>
            <label htmlFor="admin-secret">Admin secret</label>
            <div className="field-with-icon">
              <Icon name="lock" size={18} />
              <input
                id="admin-secret"
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                autoFocus
                required
              />
            </div>
            {error && (
              <p className="inline-alert" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button">Sign in</button>
          </form>
        </main>
      ) : (
        <main className="settings-card material material--heavy">
          <div className="settings-heading">
            <p className="eyebrow">Bloop controls</p>
            <h1>Room settings</h1>
            <p>Manage the shape and lifecycle of conversations.</p>
          </div>
          <form
            className="admin-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setSettings(
                await api('/api/admin/settings', {
                  method: 'PATCH',
                  body: JSON.stringify(settings),
                }),
              );
              setSaved(true);
              window.setTimeout(() => setSaved(false), 2000);
            }}
          >
            <section className="settings-section">
              <h2>Availability</h2>
              <Toggle
                checked={settings.publicRoomEnabled}
                onChange={(checked) => setSettings({ ...settings, publicRoomEnabled: checked })}
                label="Public Lounge"
                description="Let anyone with access to Bloop join."
              />
              <Toggle
                checked={settings.privateRoomEnabled}
                onChange={(checked) => setSettings({ ...settings, privateRoomEnabled: checked })}
                label="Private Room"
                description="Allow entry with the shared encrypted-room password."
              />
            </section>
            <section className="settings-section">
              <h2>Limits</h2>
              <div className="number-setting">
                <span>
                  <label htmlFor="room-capacity">Room capacity</label>
                  <small>Maximum people connected to a room.</small>
                </span>
                <input
                  id="room-capacity"
                  type="number"
                  min="1"
                  max="30"
                  value={settings.roomCapacity}
                  onChange={(event) =>
                    setSettings({ ...settings, roomCapacity: Number(event.target.value) })
                  }
                />
              </div>
              <div className="number-setting">
                <span>
                  <label htmlFor="retention-days">Message retention</label>
                  <small>Days before old messages are removed.</small>
                </span>
                <div>
                  <input
                    id="retention-days"
                    type="number"
                    min="1"
                    max="365"
                    value={settings.messageRetentionDays}
                    onChange={(event) =>
                      setSettings({ ...settings, messageRetentionDays: Number(event.target.value) })
                    }
                  />
                  <span>days</span>
                </div>
              </div>
            </section>
            <div className="form-actions">
              <Link className="secondary-button" to="/public">
                Back to chat
              </Link>
              <button className="primary-button">
                <Icon name={saved ? 'check' : 'settings'} size={18} />
                {saved ? 'Saved' : 'Save settings'}
              </button>
            </div>
          </form>
        </main>
      )}
    </div>
  );
}

function App() {
  const appearance = useCustomization();
  return (
    <Routes>
      <Route path="/" element={<Room roomId="public" />} />
      <Route path="/public" element={<Room roomId="public" />} />
      <Route path="/private" element={<Room roomId="private" />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/appearance" element={<Appearance appearance={appearance} />} />
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
