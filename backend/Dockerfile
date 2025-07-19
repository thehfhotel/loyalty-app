FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript (for production)
RUN npm run build || echo "Build will run in dev mode"

# Expose port
EXPOSE 4000

# Start the application
CMD ["npm", "run", "dev"]