-- Password resets.
--
-- An admin issues a link; the person follows it and chooses their own password.
-- The admin never learns it, which is better than the obvious alternative of
-- letting them set one and read it out - a password an administrator knows is
-- a password two people know.
--
-- Same shape as invites for the same reasons: single use, short lived, and
-- stored only as a hash so a copy of this table is not a set of live resets.

create table if not exists password_resets (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists password_resets_user_idx on password_resets (user_id);

alter table password_resets enable row level security;
