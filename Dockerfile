# =========================
# Base image
# =========================
FROM node:20-alpine AS base

# Install only required system deps (NO canvas deps)
RUN apk add --no-cache curl python3 make g++ && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV npm_config_fetch_timeout=120000
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_retries=10

WORKDIR /usr/src/app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# =========================
# Dependencies (prod only)
# =========================
FROM base AS deps

COPY package.json package-lock.json ./

# IMPORTANT:
# npm ci installs EXACTLY what's in package-lock.json
# canvas must already be removed from lockfile
# Using npm install with build-from-source for bcrypt and other native modules
RUN npm install --only=prod --legacy-peer-deps --build-from-source --verbose 2>&1 | grep -E "^npm|added|up to date|warn" || true && \
    ls -la /usr/src/app/node_modules | head -20 && \
    npm cache clean --force || true

# =========================
# Final runtime image
# =========================
FROM base AS production

# Copy node_modules
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy app source
COPY . .

# Create runtime directories with proper permissions
RUN mkdir -p uploads logs && \
    chown -R appuser:appgroup /usr/src/app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Use shell form for better signal handling
CMD ["node", "server.js"]
