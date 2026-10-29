-- Least-privilege split (docs/design/accounts-api.md §4.1): migrations run as
-- the owner `anime`, requests run as `anime_app`, which gets row access only.
-- The role itself is created outside migrations (db/init/01-app-role.sh for a
-- fresh compose volume, docs/04-deployment.md for an existing one). Nothing
-- here touches drizzle.__drizzle_migrations, which stays the owner's alone.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "anime_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE "anime" IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "anime_app";
