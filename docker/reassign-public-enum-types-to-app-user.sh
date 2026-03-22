#!/bin/sh
# Fix PostgreSQL error 42501 "must be owner of type ..." when Prisma migrations
# run as CLIRA_DB_APP_USER but enum types were created by another role (e.g. postgres
# after a restore or a one-off migrate with a superuser URL).
#
# Run as the superuser on the DB container, after the database exists:
#   docker compose exec db sh /docker-entrypoint-initdb.d/../path-not-mounted
#
# From repo root (host has this file; db container does not mount ../docker by default):
#   docker compose cp docker/reassign-public-enum-types-to-app-user.sh db:/tmp/
#   docker compose exec db sh /tmp/reassign-public-enum-types-to-app-user.sh
#
# Or pipe SQL (see inline psql below).
set -eu

APP_USER="${CLIRA_DB_APP_USER:-clira_app}"
DB_NAME="${POSTGRES_DB:-clira}"
POSTGRES_USER_NAME="${POSTGRES_USER:-postgres}"

psql \
  -v ON_ERROR_STOP=1 \
  --set=app_user="$APP_USER" \
  --username "$POSTGRES_USER_NAME" \
  --dbname "$DB_NAME" <<'SQL'
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE %I OWNER TO %I', r.typname, :'app_user');
  END LOOP;
END
$$;
SQL

echo "Reassigned ownership of public enum types to ${APP_USER}."
