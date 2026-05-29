FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    STORAGE_DRIVER=sqlite \
    SQLITE_DB_PATH=/app/data/echomate.sqlite
RUN groupadd --gid 10001 echomate \
  && useradd --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin echomate \
  && mkdir -p /app/data \
  && chown -R 10001:10001 /app
COPY --from=deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/src/db/migrations ./src/db/migrations
COPY --from=build --chown=10001:10001 /app/prompts ./prompts
COPY --from=build --chown=10001:10001 /app/config ./config
COPY --from=build --chown=10001:10001 /app/package*.json ./
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HEALTH_CHECK_PORT || 3000) + '/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
