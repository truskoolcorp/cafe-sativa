-- Runs only in the empty, disposable PostgreSQL container created by run-ci.sh.
-- No Auth tables: the official GoTrue binary installs its own complete schema.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
  NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD 'synthetic-auth-ci-only';
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
GRANT CREATE ON DATABASE cafe_auth_service_test TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth;
ALTER ROLE supabase_auth_admin SET statement_timeout = '10s';
ALTER ROLE supabase_auth_admin SET lock_timeout = '3s';
COMMENT ON DATABASE cafe_auth_service_test IS 'cafe-disposable-auth-service-v1';
