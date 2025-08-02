FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code and pre-built dist
COPY . .

# Ensure dist directory exists (try build but continue if it fails, dist may already exist)
RUN [ -d "dist" ] && echo "Using existing dist directory" || (npm run build 2>/dev/null || echo "Build failed, checking for existing dist") && ls -la dist/

# Create non-root user for security first
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Create directories that need to be writable and set ownership
RUN mkdir -p /app/storage /app/storage/backup /app/storage/avatars /app/logs \
    && chown -R nodejs:nodejs /app

# Set proper permissions for logs directory specifically
RUN chmod 755 /app/logs && chown nodejs:nodejs /app/logs

USER nodejs

# Expose port
EXPOSE 4000

# Start the application (will be overridden by docker-compose for dev)
CMD ["npm", "start"]