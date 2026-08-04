-- Congruo initial schema.
--
-- Only released records land here. Raw archives are parsed in the browser and
-- are never uploaded, so there is deliberately no table for them.

create extension if not exists "pgcrypto";

-- One fielding.
--
-- `mode` decides whether we run the interview or only the capture:
--   full_service - consent, survey, review, release, reconcile, all with us
--   append       - the client's platform runs the interview; we capture only,
--                  and there is no reconcile step because we never see answers
create table if not exists studies (
  slug          text primary key,
  name          text not null,
  mode          text not null check (mode in ('full_service', 'append')),
  sources       text[] not null,
  -- Hosts a respondent may be redirected back to. Return URLs arrive in the
  -- query string, so without an allowlist a live study is an open redirect.
  return_hosts  text[] not null default '{}',
  default_return_url text,
  -- Query parameter names the referring platform expects on the way back.
  respondent_param text not null default 'rid',
  status_param     text not null default 'status',
  window_from   timestamptz,
  window_to     timestamptz,
  created_at    timestamptz not null default now()
);

-- One respondent working through one study.
create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  study_slug    text not null references studies(slug),
  -- The referring platform's own respondent id, in append mode. This is the
  -- only join key between our records and the client's survey file. We hold
  -- nothing else identifying, which is why our file is inert on its own.
  external_respondent_id text,
  created_at    timestamptz not null default now(),
  survey_done_at timestamptz,
  released_at   timestamptz,
  -- Set when the respondent finishes but chooses not to release. These
  -- sessions are the reason donation-selection bias is measurable, so they
  -- must be retained rather than cleaned up.
  declined_at   timestamptz
);

create index if not exists sessions_external_idx
  on sessions (study_slug, external_respondent_id);

-- Per-source consent. One row per grant, never updated in place: a change of
-- mind is a new row, so the history is the audit trail.
create table if not exists consent_grants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  source       text not null,
  granted      boolean not null,
  -- Exactly what the respondent was shown when they decided.
  disclosure_version text not null,
  comprehension_passed boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists consent_grants_session_idx
  on consent_grants (session_id);

-- What the respondent released. One row per search or prompt.
create table if not exists released_records (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  source       text not null,
  occurred_at  timestamptz not null,
  text         text not null,
  context      text,
  released_at  timestamptz not null default now()
);

create index if not exists released_records_session_idx
  on released_records (session_id);
create index if not exists released_records_occurred_idx
  on released_records (occurred_at);

-- What we told the respondent we received. Written once, never amended.
create table if not exists release_receipts (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  released_count integer not null,
  withheld_count integer not null,
  sources        text[] not null,
  earliest       timestamptz,
  latest         timestamptz,
  created_at     timestamptz not null default now()
);

-- Nothing here is reachable from the browser. All writes go through the
-- service role in a route handler; enabling RLS with no policies denies the
-- anon and authenticated roles by default.
alter table studies           enable row level security;
alter table sessions          enable row level security;
alter table consent_grants    enable row level security;
alter table released_records  enable row level security;
alter table release_receipts  enable row level security;
