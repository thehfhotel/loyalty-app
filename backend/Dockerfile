FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code and pre-built dist
COPY . .

# Try to build TypeScript, but fall back to running TypeScript directly if compilation fails
RUN npm run build || echo "TypeScript compilation failed, will run with tsx"

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

# Start the application - use compiled version if available, otherwise run with tsx
CMD ["sh", "-c", "if [ -f dist/index.js ]; then npm start; else npx tsx src/index.ts; fi"]