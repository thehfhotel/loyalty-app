FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Skip TypeScript build for now due to compilation errors
# TODO: Fix TypeScript errors and re-enable production build
# RUN npm run build:prod || npm run build

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