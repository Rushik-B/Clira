#!/bin/sh
set -eu

APP_USER="${CLIRA_DB_APP_USER:-clira_app}"
APP_PASSWORD="${CLIRA_DB_APP_PASSWORD:-clira_app}"
DB_NAME="${POSTGRES_DB:-clira}"
POSTGRES_USER_NAME="${POSTGRES_USER:-postgres}"

psql \
  -v ON_ERROR_STOP=1 \
  --set=app_user="$APP_USER" \
  --set=app_password="$APP_PASSWORD" \
  --set=db_name="$DB_NAME" \
  --username "$POSTGRES_USER_NAME" \
  --dbname "$DB_NAME" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password');
  END IF;
END
$$;

GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
SQL



