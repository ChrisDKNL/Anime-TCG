#!/bin/sh
# Runs once, when the Postgres entrypoint initialises an empty data volume
# (compose mounts this folder read-only at /docker-entrypoint-initdb.d/).
# Creates the role the api serves requests as; its grants come from the
# migration 0001_app_role_grants.sql the api applies at start-up, so this
# script owns the role's existence and password and nothing else. On a volume
# that already exists the entrypoint skips this folder: docs/04-deployment.md
# has the same statement to run by hand.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set for the db service}"

# The password is passed as a psql variable so it is quoted as a literal
# (%L) and never interpolated into the SQL text by the shell.
psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE anime_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anime_app')
\gexec
SQL
