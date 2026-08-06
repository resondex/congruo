-- Deletion, which the consent copy has promised since the beginning.
--
-- Three screens tell the respondent they can have their data removed at any
-- time, and one of them is the tickbox they must accept to take part. Nothing
-- implemented it. This does.
--
-- THE PROBLEM IS IDENTIFYING THEM, NOT DELETING.
--
-- We deliberately hold nothing that identifies a respondent - no name, no
-- address, no account. That is a strength and it is exactly what makes "delete
-- my data" unanswerable: somebody writes in, and there is no way to find their
-- row or to know the request is theirs. So the receipt issues a token. It
-- identifies the session and proves the holder completed it, and it teaches us
-- nothing new about them.
--
-- WHAT REMAINS IS A TOMBSTONE.
--
-- The session row survives with its contents gone: no answers, no records, no
-- receipt, no reconciliation, no variables, no quality flags, no consent
-- grants. What it keeps is that a case existed here and was withdrawn, so a
-- count does not silently shrink and a client can tell a withdrawal from a
-- respondent who never arrived.
--
-- The referring platform's respondent id is kept on a tombstone in append
-- mode. It is the client's own identifier and it is the only way they can
-- carry out the same deletion on their side; removing it would leave them
-- holding that person's survey answers forever with no way to know they had
-- asked to be forgotten. Serving the request means passing it on.

alter table sessions
  -- Only the hash. A copy of this table is not a set of live deletion keys.
  add column if not exists deletion_token_hash text,
  add column if not exists deleted_at timestamptz;

create index if not exists sessions_deletion_token_idx
  on sessions (deletion_token_hash) where deletion_token_hash is not null;

comment on column sessions.deleted_at is
  'Set when the respondent withdrew. The row is a tombstone: its contents are gone.';
