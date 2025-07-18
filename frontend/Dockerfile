FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY public/ ./public/
COPY src/ ./src/

# Accept build arguments for React environment variables
ARG REACT_APP_API_URL
ARG REACT_APP_FIREBASE_CONFIG
ARG REACT_APP_DOMAIN

# Set environment variables for the build process
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_FIREBASE_CONFIG=$REACT_APP_FIREBASE_CONFIG
ENV REACT_APP_DOMAIN=$REACT_APP_DOMAIN

# Build the application
RUN npm run build

# Install serve to serve the built application
RUN npm install -g serve

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["serve", "-s", "build", "-l", "3000"]