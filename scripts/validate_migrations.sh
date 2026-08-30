#!/usr/bin/env bash
# Validates the migration chain against a scratch Postgres database.
#
# Applies migrations/dev_stub.sql (a minimal stand-in for the
# Supabase-managed environment: auth schema, auth.uid(), client roles)
# and then every numbered migration in order. Intended for CI and local
# checks — never point it at a real Supabase project.
#
# Usage:
#   DATABASE_URL=postgresql://postgres@localhost:5432/migrations_check \
#     ./scripts/validate_migrations.sh
set -euo pipefail

DB="${DATABASE_URL:?Set DATABASE_URL to a scratch Postgres database}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

psql "$DB" -v ON_ERROR_STOP=1 -q -c "create extension if not exists pgcrypto;"
psql "$DB" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/dev_stub.sql"

for migration in "$MIGRATIONS_DIR"/0*.sql; do
    echo "Applying $(basename "$migration")"
    psql "$DB" -v ON_ERROR_STOP=1 -q -f "$migration"
done

echo "All migrations applied cleanly."
