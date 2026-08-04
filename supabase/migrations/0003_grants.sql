-- Grants.
--
-- Grants and RLS are separate layers. RLS decides which rows a role may see;
-- grants decide whether the role may touch the table at all. service_role
-- bypasses RLS but is still stopped by a missing grant.
--
-- Supabase projects created before 30 May 2026 auto-granted every table in
-- `public` to anon, authenticated and service_role, and exposed it through the
-- Data API on creation. Newer projects grant nothing. This migration states
-- what we want explicitly so it behaves the same either way:
--
--   service_role         -> full access, because every write goes through it
--   anon, authenticated  -> nothing, because no browser ever talks to the API
--
-- Leave "Automatically expose new tables" off in the project's API settings.

-- Everything reaches the database through a route handler using the service
-- role. Nothing else needs a seat.
grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Future tables inherit the same shape, so a migration that forgets to grant
-- does not fail confusingly at runtime.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- The browser has no Supabase client and never will: released records reach us
-- through /api/release, not through PostgREST. These revokes are no-ops on a
-- new project and the fix on an older one.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
