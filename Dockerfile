# Base image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install system dependencies if required
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy source code and assets
COPY src/ ./src/
COPY public/ ./public/
COPY sample_images/ ./sample_images/

# Create storage directory for persistence
RUN mkdir -p storage/uploads storage/processed

# Expose port
EXPOSE 3000

# Environment defaults
ENV PORT=3000
ENV NODE_ENV=production
ENV QUEUE_CONCURRENCY=3
ENV STORAGE_DIR=storage

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/server.js"]
