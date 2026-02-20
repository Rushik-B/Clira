FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# Dummy build-time env vars so module initialization doesn't throw.
# These are never used at runtime — real values come from docker-compose / .env.
ARG DATABASE_URL=postgresql://dummy:dummy@dummy:5432/dummy
ARG REDIS_URL=redis://dummy:6379
RUN DATABASE_URL="${DATABASE_URL}" REDIS_URL="${REDIS_URL}" NODE_OPTIONS="--max-old-space-size=4096" npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
