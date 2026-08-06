-- Passkeys.
--
-- A key pair held by the device or password manager. The private half never
-- leaves it and we only ever store the public half, so this table is not worth
-- stealing - unlike a password hash, which is.
--
-- The property passwords cannot have: a passkey is bound to the origin that
-- created it, so a convincing copy of our login page cannot use one. A TOTP
-- code can be typed into a fake page; a passkey cannot be handed to one.

create table if not exists webauthn_credentials (
  -- Base64url credential id from the authenticator.
  id            text primary key,
  user_id       uuid not null references users(id) on delete cascade,
  public_key    bytea not null,
  -- Replay defence: authenticators that implement it increment on each use, so
  -- a counter that goes backwards means a cloned key.
  counter       bigint not null default 0,
  -- What the person will recognise it by: "MacBook Touch ID", "1Password".
  label         text,
  transports    text[],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists webauthn_credentials_user_idx
  on webauthn_credentials (user_id);

-- Challenges, held between the two halves of a registration or a sign-in.
--
-- Server-side rather than in a cookie so that one can be spent exactly once:
-- the whole point is that the signature covers a value we chose and have not
-- seen returned before.
create table if not exists webauthn_challenges (
  challenge  text primary key,
  -- Null while signing in, since we do not yet know who is asking.
  user_id    uuid references users(id) on delete cascade,
  kind       text not null check (kind in ('register', 'authenticate')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table webauthn_credentials enable row level security;
alter table webauthn_challenges  enable row level security;
