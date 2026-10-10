# ---- Stage 1: build the frontend ----
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: production service ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && (npm ci --omit=dev || npm install --omit=dev)
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Litestream: continuous SQLite backup to R2 (Stage 0, docs/INFRASTRUCTURE.md §7).
# Started by the entrypoint only when R2_* env vars are present.
COPY --from=litestream/litestream:0.5.2 /usr/local/bin/litestream /usr/local/bin/litestream
RUN chmod +x backend/entrypoint.sh

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8787}/api/health || exit 1

WORKDIR /app/backend
ENTRYPOINT ["./entrypoint.sh"]
