# Start with Node.js 20 Alpine (lightweight)
FROM node:20-alpine

# Add OS dependencies for Python, ffmpeg, etc.
RUN apk add --no-cache \
    bash \
    python3 \
    py3-pip \
    git \
    ffmpeg \
    build-base \
    libstdc++ \
    libc6-compat

# Install Whisper + torch using pip
RUN pip install --upgrade pip && \
    pip install torch && \
    pip install git+https://github.com/openai/whisper.git

# Optional: preload whisper model (base)
# This prevents model download delays during runtime
RUN whisper --model base --language en --output_format txt --output_dir /tmp dummy.wav || true

# Set working directory
WORKDIR /usr/src/app

# Copy only package files first for caching
COPY package*.json ./
RUN npm i --only=production

# Copy the rest of the app source code
COPY . .

# Expose the app port
EXPOSE 5000

# Create non-root user and switch to it
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser


CMD ["npm", "start"]