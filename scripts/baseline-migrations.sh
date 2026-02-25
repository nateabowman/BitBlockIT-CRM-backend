#!/bin/bash
# Usage: DATABASE_URL="postgresql://..." ./scripts/baseline-migrations.sh
set -e
[[ -z "$DATABASE_URL" ]] && { echo "DATABASE_URL is required"; exit 1; }
cd "$(dirname "$0")/.."
for m in $(ls -1 prisma/migrations | sort); do
  echo "Resolving $m..."
  npx prisma migrate resolve --applied "$m"
done
echo "Baseline complete. Running migrate deploy..."
npx prisma migrate deploy
