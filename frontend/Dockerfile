FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build for production (with API URL for build-time environment variable)
ARG VITE_API_URL=https://loyalty.saichon.com/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build || echo "Build failed, will try at runtime"

# Expose port
EXPOSE 3000

# Start Vite dev server (will be overridden by docker-compose for production)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]