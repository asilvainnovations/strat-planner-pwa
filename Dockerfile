# ============================================================
# STRAT PLANNER PRO — DOCKERFILE
# Multi-stage build: deps → production
#
# Build:  docker build -t strat-planner-pro .
# Run:    docker run -p 4000:4000 --env-file .env strat-planner-pro
# ============================================================

# ── Stage 1: Install dependencies ───────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files only — layer cached until deps change
COPY package*.json ./

# Install production deps only (no devDependencies)
RUN npm ci --omit=dev --ignore-scripts && \
    # Clean npm cache to reduce image size
    npm cache clean --force


# ── Stage 2: Production image ────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling and process reaping
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create runtime directories with correct permissions
# data/ and uploads/ are typically mounted as volumes
RUN mkdir -p data uploads && \
    chown -R node:node /app

# Copy installed node_modules from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy source code (gitignore patterns are respected by .dockerignore)
COPY --chown=node:node . .

# Remove devDependency config files not needed at runtime
RUN rm -f .eslintrc.json \
          .eslintignore \
          jest.config.js \
          tests/ 2>/dev/null || true

# Run as non-root user
USER node

EXPOSE 4000

# Health check — used by docker-compose and orchestrators
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use dumb-init so Node.js receives SIGTERM properly (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
