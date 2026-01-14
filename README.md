# Chatroom

Real-time, two-room guest chat. Public and private rooms have independently enforced 30-session limits. Guest identity is held by a signed HTTP-only cookie; the database stores only its SHA-256 hash.

## Start locally

```powershell
Copy-Item .env.example .env
pnpm.cmd install
docker compose up -d postgres
pnpm.cmd --filter @chatroom/server prisma:migrate
pnpm.cmd dev
```

Open `http://localhost:5173`. Health/readiness are `/api/health` and `/api/ready`.

Generate a private password hash, then put it in `.env`:

```powershell
pnpm.cmd --filter @chatroom/server password:hash "your shared password"
```

## Checks and production

```powershell
pnpm.cmd format:check
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
docker compose up --build
```

The Compose stack is a local HTTP environment, so it uses development cookie mode. In production, terminate TLS, set `NODE_ENV=production`, and use a Secure cookie.

## Architecture and security

`apps/web` is Vite/React; `apps/server` is Fastify, Prisma, PostgreSQL, and `ws`; `packages/shared` owns schema/event contracts. The server validates HTTP and WebSocket data, authenticates upgrades from cookies, scopes message lookups by room, uses Argon2id for private access, performs soft deletion, validates avatar signatures, and limits request/message payloads. Rotate the shared private password immediately if leaked.

Redis is used for cross-instance room-session leases (the 30-user capacity), presence records, and WebSocket event fan-out. Every server instance must point at the same `REDIS_URL`; use managed Redis with persistence/replication for production.

Avatars are local development storage only; production should use object storage, distributed rate limiting/presence, TLS, a reverse proxy, migrations in CI, and fuller browser/integration tests.
