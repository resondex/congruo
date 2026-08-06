-- Accounts, organisations and sessions for the admin surface.
--
-- ---------------------------------------------------------------------------
-- RESPONDENTS NEVER APPEAR IN THESE TABLES.
--
-- Everything here is for the people who run studies. A respondent arrives from
-- a link, does the thing, and leaves; asking them to make an account would cost
-- most of them at the door and buys nothing. /s/[study] and /capture/* stay
-- open. See docs/architecture.md.
-- ---------------------------------------------------------------------------

create table if not exists orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- Used in URLs, so it is stable and lowercase.
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- Who may sign in, and to what.
--
--   staff         - Resondex. Every org, every study, no org of their own.
--   client_admin  - one org. May create and edit that org's studies.
--   client_viewer - one org. May read and download, nothing else.
--
-- The org column is the whole security model: every query for a client is
-- filtered by it, and a client with a null org would see nothing rather than
-- everything. That asymmetry is deliberate - the failure mode of this check
-- must be an empty page, never someone else's respondents.
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  -- Stored lowercased; the app folds case before writing or looking up.
  email         text not null unique,
  name          text,
  role          text not null check (role in ('staff', 'client_admin', 'client_viewer')),
  org_id        uuid references orgs(id) on delete cascade,
  -- scrypt. Null until an invite is accepted and a password is set.
  password_hash text,
  password_salt text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  -- Set rather than deleting the row, so their studies keep an author.
  disabled_at   timestamptz,

  constraint staff_have_no_org
    check ((role = 'staff' and org_id is null) or (role <> 'staff' and org_id is not null))
);

create index if not exists users_org_idx on users (org_id);

-- Signed-in sessions.
--
-- The cookie carries a random token; only its hash is stored, so a leaked
-- database does not hand over live sessions.
create table if not exists auth_sessions (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text
);

create index if not exists auth_sessions_user_idx on auth_sessions (user_id);

-- Invitations. There is no self-serve signup: an account exists because
-- somebody with the authority to create it did.
create table if not exists invites (
  token_hash text primary key,
  email      text not null,
  role       text not null check (role in ('staff', 'client_admin', 'client_viewer')),
  org_id     uuid references orgs(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create index if not exists invites_email_idx on invites (lower(email));

-- Studies belong to an org.
--
-- Nullable so the development studies, which predate this, keep working
-- without being owned by anyone. A null org is visible to staff only - the
-- same fail-closed rule as above.
alter table studies
  add column if not exists org_id uuid references orgs(id) on delete cascade,
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists created_at_admin timestamptz not null default now(),
  -- Whether a download may contain what respondents actually typed.
  --
  -- Default true because it is what the instrument is for. A fielding that
  -- cannot justify holding verbatim text turns this off at setup and the
  -- export ships counts, matches and scores instead - a decision made once,
  -- in advance, rather than argued about per download request.
  add column if not exists export_raw_text boolean not null default true;

create index if not exists studies_org_idx on studies (org_id);

alter table orgs          enable row level security;
alter table users         enable row level security;
alter table auth_sessions enable row level security;
alter table invites       enable row level security;
