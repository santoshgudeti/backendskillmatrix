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
    pkgconfig \
    pixman-dev \
    freetype-dev \
    && rm -rf /var/cache/apk/*

# Set environment variables
ENV NODE_ENV=production
ENV PYTHON=/usr/bin/python3
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV SKIP_CANVAS_INSTALL=true

# Create app directory
WORKDIR /usr/src/app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Dependencies stage
FROM base AS dependencies

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --include=dev --legacy-peer-deps

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
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

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

# Health check - simplified ping check since there's no /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('net').connect(5000, 'localhost', () => process.exit(0)).on('error', () => process.exit(1))" || exit 1

# Expose port
EXPOSE 5000

# Add labels for better container management
LABEL maintainer="skillmatrix-dev-team"
LABEL version="1.0"
LABEL description="SkillMatrix AI Backend Server"

# Start the application
CMD ["node", "server.js"]