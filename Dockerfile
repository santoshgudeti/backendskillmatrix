# Multi-stage build for optimized production image
FROM node:20-alpine AS base

# Install system dependencies for canvas and native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    fontconfig \
    ttf-dejavu \
    ttf-freefont \
    ttf-liberation \
    ttf-opensans \
    && rm -rf /var/cache/apk/*

# Set environment variables
ENV NODE_ENV=production
ENV PYTHON=/usr/bin/python3
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Create app directory
WORKDIR /usr/src/app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Dependencies stage
FROM base AS dependencies

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev

# Build stage
FROM dependencies AS build

# Copy source code
COPY . .

# Build the application (if you have any build steps)
# RUN npm run build

# Production dependencies stage
FROM base AS production-deps

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Final production image
FROM base AS production

# Copy production dependencies
COPY --from=production-deps /usr/src/app/node_modules ./node_modules

# Copy application code
COPY --from=build /usr/src/app ./

# Create necessary directories
RUN mkdir -p /usr/src/app/uploads /usr/src/app/logs

# Set proper permissions
RUN chown -R appuser:appgroup /usr/src/app

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]