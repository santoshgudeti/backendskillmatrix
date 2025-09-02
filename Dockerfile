# Use official Node.js Alpine image
FROM node:20-alpine
 
# Set working directory
WORKDIR /usr/src/app
 
# Install required build tools and libraries for canvas
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
  ttf-freefont
 
# Set environment variable for node-gyp
ENV PYTHON=/usr/bin/python3
 
# Copy dependency definitions
COPY package*.json ./
 
# Install only production dependencies
RUN npm i --only=production
 
# Copy application source code
COPY . .
 
# Create non-root user and switch to it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
 
# Expose the app's port
EXPOSE 5000
 
# Default command to run the app
CMD ["npm", "start"]