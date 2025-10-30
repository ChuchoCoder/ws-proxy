# Use official Node.js LTS runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Add a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S wsproxyuser -u 1001

# Copy package files first (for better Docker layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Change ownership to non-root user
RUN chown -R wsproxyuser:nodejs /app
USER wsproxyuser

# Expose port (Render will set PORT env variable)
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { hostname: 'localhost', port: process.env.PORT || 10000, path: '/health', timeout: 2000 }; \
    const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Start the application
CMD ["npm", "start"]