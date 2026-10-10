#!/bin/sh
# Stage-0 entrypoint (docs/INFRASTRUCTURE.md): start Litestream replication to
# R2 alongside the app when the bucket is configured, then run the server.
set -e

if [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_BUCKET" ] && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
  echo "[entrypoint] starting litestream replication -> s3://$R2_BUCKET"
  litestream replicate -config /app/litestream.yml &
else
  echo "[entrypoint] R2 not configured — skipping litestream (backups disabled)"
fi

exec node src/index.js
