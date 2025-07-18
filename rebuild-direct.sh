#!/bin/bash

# Direct rebuild script for user service
echo "🔄 Rebuilding user service..."

# Change to project directory
cd /home/nut/loyalty-app

# Stop the current user service
echo "🛑 Stopping user service..."
docker-compose stop user-service

# Remove the existing container
echo "🗑️  Removing existing container..."
docker-compose rm -f user-service

# Rebuild the user service image
echo "🔨 Building new user service image..."
docker-compose build user-service

# Start the user service
echo "🚀 Starting user service..."
docker-compose up -d user-service

# Wait a moment for the service to start
echo "⏳ Waiting for service to start..."
sleep 3

# Check the service status
echo "📊 Service status:"
docker-compose ps user-service

# Show recent logs
echo "📋 Recent logs:"
docker-compose logs --tail=10 user-service

echo "✅ User service rebuild complete!"