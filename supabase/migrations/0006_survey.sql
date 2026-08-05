-- The survey instrument.
--
-- Questions live in the database rather than in code, for the same reason the
-- return-host allowlist does: a fielding tool whose questionnaire needs a
-- deploy to change is the wrong shape. One deployment runs many studies and
-- each brings its own instrument.
--
-- Append-mode studies have no rows here. Their interview runs on the client's
-- platform and we never see the answers - which is also why those studies get
-- no reconcile step.

create table if not exists survey_questions (
  id          uuid primary key default gen_random_uuid(),
  study_slug  text not null references studies(slug) on delete cascade,

  -- Stable name for analysis. The client's tables are keyed on this, so it
  -- must survive reordering and rewording of the prompt.
  code        text not null,

  -- Order within the instrument. `page` groups questions onto one screen;
  -- questions sharing a page are answered together. One per page is the
  -- default because this is answered on a phone.
  position    integer not null,
  page        integer not null default 0,

  type        text not null check (
                type in ('single', 'multiple', 'scale', 'number', 'text')
              ),
  prompt      text not null,
  help        text,

  -- [{ "value": "chatgpt", "label": "ChatGPT" }, ...] for single/multiple.
  options     jsonb not null default '[]'::jsonb,
  required    boolean not null default true,

  -- Bounds for scale and number. A scale renders every point between them.
  min_value   double precision,
  max_value   double precision,
  min_label   text,
  max_label   text,

  -- What record-side quantity this question is a self-report OF.
  --
  -- This is the whole point of the instrument and the reason the survey module
  -- is not a generic form builder. Congruence is only measurable where a
  -- question and a record measure the same thing, so the binding has to be
  -- declared at authoring time rather than guessed afterwards. The reconcile
  -- module reads this; nothing here computes it.
  --
  --   {"kind":"source_use"}
  --       Option values are source names. The set chosen is the claim.
  --   {"kind":"search_frequency","sources":[...],"windowDays":30}
  --       The number given is a claimed count of records in that window.
  --   {"kind":"topic_search","terms":[...],"windowDays":30}
  --       A yes answer claims at least one record matching those terms.
  claim       jsonb,

  created_at  timestamptz not null default now(),

  unique (study_slug, code)
);

create index if not exists survey_questions_study_idx
  on survey_questions (study_slug, position);

-- What the respondent said, before they saw any of their own records.
--
-- Values are split by type rather than kept as jsonb so that analysis is
-- ordinary SQL. This file is delivered to clients; `avg(value_number)` should
-- not require a cast.
create table if not exists survey_answers (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  question_code text not null,

  value_text    text,
  value_number  double precision,
  value_choices text[],

  -- Recorded per answer, not just per session: the gap between the first and
  -- last answer is the only straggling-respondent signal we have, and a
  -- session stamp alone would hide it.
  answered_at   timestamptz not null default now(),

  -- A respondent who goes back and changes an answer, or whose submission is
  -- retried after a dropped connection, must not produce a second row.
  unique (session_id, question_code)
);

create index if not exists survey_answers_session_idx
  on survey_answers (session_id);

alter table survey_questions enable row level security;
alter table survey_answers   enable row level security;
