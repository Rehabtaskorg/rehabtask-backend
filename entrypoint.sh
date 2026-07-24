#!/bin/sh
set -e
echo "Running Prisma migrations..."
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate resolve --rolled-back 20260724000000_patient_scoped_conversations 2>/dev/null || true
DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy
echo "Seeding visit types..."
node prisma/seedVisitTypes.js
echo "Starting server..."
exec node src/server.js
