#!/bin/sh
set -e
echo "Resolving any previously failed migrations..."
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate resolve --rolled-back 20260704000000_user_id_varchar 2>/dev/null || true
echo "Running Prisma migrations..."
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy
echo "Seeding visit types..."
node prisma/seedVisitTypes.js
echo "Starting server..."
exec node src/server.js
