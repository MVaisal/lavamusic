#!/bin/sh

# Run database migrations
echo "Running database initialization..."
npm run generate
npm run push

# Start the application
echo "Starting LavaMusic..."
exec "$@"
