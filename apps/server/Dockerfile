FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @chatroom/server prisma:generate && pnpm --filter @chatroom/shared build && pnpm --filter @chatroom/server build
CMD ["sh", "-c", "cd apps/server && npx prisma migrate deploy && node dist/index.js"]
