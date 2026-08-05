-- Reconciliation: what the respondent said about a divergence.
--
-- The divergence itself is arithmetic and is recomputed from survey_answers
-- and released_records whenever it is needed. What cannot be recomputed, and
-- is the reason this step exists, is the respondent's account of it while they
-- are still in session.
--
-- These rows never amend survey_answers. The self-report was given before the
-- respondent saw a single record of their own, and that is what makes it
-- usable; letting a later view of the record edit it backwards would destroy
-- the measurement this whole sequence is arranged to protect.

create table if not exists reconcile_responses (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  question_code text not null,

  -- The comparison as it was shown, kept verbatim.
  --
  -- Recomputing it later would not reproduce it: a respondent can ask us to
  -- delete records afterwards, and the arithmetic would then disagree with the
  -- explanation attached to it. An explanation is only interpretable next to
  -- the claim it was given about.
  claimed       text not null,
  observed      text not null,
  agreed        boolean not null,
  -- Reasons the divergence may not be a divergence at all: records held back,
  -- an archive too short to cover the window, a source never granted.
  caveats       text[] not null default '{}',

  -- Coded explanation. `different_meaning` is the one to watch: it says the
  -- question and the record were never measuring the same thing, which is a
  -- finding about the instrument rather than about the respondent.
  explanation   text check (explanation in (
                  'misremembered',
                  'not_me',
                  'withheld',
                  'different_meaning',
                  'other_device',
                  'record_wrong',
                  'other'
                )),
  note          text,

  created_at    timestamptz not null default now(),

  unique (session_id, question_code)
);

create index if not exists reconcile_responses_session_idx
  on reconcile_responses (session_id);

-- When the respondent finished the reconcile step. Distinct from released_at:
-- releasing and then closing the tab is a complete release and an incomplete
-- reconciliation, and collapsing the two would overstate what we hold.
alter table sessions
  add column if not exists reconciled_at timestamptz;

alter table reconcile_responses enable row level security;
