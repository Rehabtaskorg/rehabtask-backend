#!/bin/sh
echo "Running Prisma migrations..."
npx prisma migrate deploy
echo "Starting server..."
exec node src/server.js
