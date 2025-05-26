# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Install dependencies separately for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose port (change if your app uses a different port)
EXPOSE 3000

# Use non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Start the server
CMD ["npm", "start"]