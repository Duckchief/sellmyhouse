#!/bin/sh
set -e

# Fetch secrets from OVHcloud Secret Manager
if [ -f "$OVH_CREDENTIALS_PATH" ]; then
  echo "[entrypoint] Fetching secrets from OVHcloud Secret Manager..."
  eval "$(node /app/dist/scripts/fetch-secrets.js)"
  echo "[entrypoint] Secrets loaded."
fi

# Run database migrations
echo "[entrypoint] Running database migrations..."
npx prisma migrate deploy

# Start the application
echo "[entrypoint] Starting application..."
exec node /app/dist/server.js
