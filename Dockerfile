FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS runtime
RUN addgroup -S -g 10001 studio && adduser -S -D -H -u 10001 -G studio studio
WORKDIR /app
ENV NODE_ENV=production PORT=8765 DATA_DIR=data
COPY --from=production-dependencies --chown=studio:studio /app/node_modules ./node_modules
COPY --from=build --chown=studio:studio /app/dist ./dist
COPY --chown=studio:studio package.json server.mjs ./
COPY --chown=studio:studio server ./server
COPY --chown=studio:studio scripts ./scripts
RUN mkdir -p /app/data && chown studio:studio /app/data
USER studio
EXPOSE 8765
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:8765/api/health >/dev/null || exit 1
ENTRYPOINT ["node", "scripts/docker-entrypoint.mjs"]
