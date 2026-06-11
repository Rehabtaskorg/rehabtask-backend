#!/bin/sh
set -e
echo "Running Prisma migrations..."
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy
echo "Seeding visit types..."
node prisma/seedVisitTypes.js
echo "Starting server..."
exec node src/server.js
