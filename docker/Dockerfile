# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Generate Prisma client (must match Alpine runtime)
COPY prisma ./prisma
RUN npx prisma generate

# Compile TypeScript (includes src/scripts/fetch-secrets.ts → dist/scripts/fetch-secrets.js)
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Copy self-hosted HTMX
RUN cp node_modules/htmx.org/dist/htmx.min.js public/js/htmx.min.js

# Build Tailwind CSS
COPY tailwind.config.ts postcss.config.js ./
RUN npx tailwindcss -i src/views/styles/input.css -o public/css/output.css --minify

# Stage 2: Runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma client and schema
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Copy compiled app (includes dist/scripts/fetch-secrets.js)
COPY --from=builder /app/dist ./dist

# Copy views (Nunjucks templates needed at runtime)
COPY src/views ./src/views

# Copy public assets
COPY public ./public
COPY --from=builder /app/public/css/output.css ./public/css/output.css

# Copy entrypoint
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node uploads

USER node

EXPOSE 3000

# Increase start-period to allow for secret fetch + migrations before health checks
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
