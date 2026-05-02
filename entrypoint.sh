#!/bin/sh
set -e
echo "Running Prisma migrations..."
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy
echo "Starting server..."
exec node src/server.js
