-- Three things a real instrument needs that a list of questions cannot express.
--
-- 1. NOT EVERYTHING ON A SCREEN IS A QUESTION.
--
-- Section headings, explanatory text, an image, and a point where the interview
-- simply ends. They sit in the same ordered list as the questions and take the
-- same show_if rules - a paragraph that only some respondents need is an
-- ordinary thing to want - so they are types rather than a parallel structure.
-- What makes them different is that they collect nothing, which the renderer
-- and the validator both read off the type.
--
-- 2. QUALITY CHECKS ARE A PROPERTY, NOT A TYPE.
--
-- An attention check is a question with a known right answer. Making it a type
-- would mean reimplementing every answer shape for it. It is a marker on an
-- ordinary question instead, and what it does when failed is FLAG, never
-- terminate: a respondent who fails one still has perfectly valid records, and
-- only their self-report is in doubt. Screening them out would also destroy the
-- ability to report how many failed, which is itself a number a client wants.
--
-- 3. NOT EVERY VARIABLE COMES FROM A RESPONDENT.
--
-- Hidden variables arrive on the link - sample source, quota cell, the client's
-- own identifiers - and are stored without ever being shown. Derived variables
-- are computed afterwards: nets, segments, banner points. Both belong in the
-- delivered file beside the answers, and neither is something to ask for.

-- --------------------------------------------------------------------------
-- Elements
-- --------------------------------------------------------------------------

alter table survey_questions drop constraint if exists survey_questions_type_check;
alter table survey_questions add constraint survey_questions_type_check
  check (type in (
    -- Answerable
    'single', 'multiple', 'scale', 'number', 'text',
    -- Shown, not asked
    'section', 'description', 'media', 'terminal'
  ));

alter table survey_questions
  add column if not exists media_url text,
  add column if not exists media_alt text,
  -- {kind, expect} - see src/lib/quality.ts. Null on an ordinary question.
  add column if not exists quality_check jsonb;

comment on column survey_questions.quality_check is
  'Marks an ordinary question as a data-quality instrument. Failing one flags the session; it never ends it.';

-- --------------------------------------------------------------------------
-- Variables that are not answers
-- --------------------------------------------------------------------------

create table if not exists study_variables (
  id         uuid primary key default gen_random_uuid(),
  study_slug text not null references studies(slug) on delete cascade,
  -- The column name in the delivered file. Same rules as a question code, and
  -- unique against them too - two things cannot own one column.
  name       text not null,
  label      text,
  kind       text not null check (kind in ('hidden', 'derived')),

  -- hidden: the query parameter it is read from.
  source_param text,

  -- derived: {buckets:[{code,label,when}], else:{code,label}}. First match
  -- wins, which is how a net or a banner point is written by hand anyway.
  rule       jsonb,

  position   integer not null default 0,
  created_at timestamptz not null default now(),

  unique (study_slug, name)
);

create index if not exists study_variables_study_idx
  on study_variables (study_slug, position);

-- What a given session's variables came out as.
create table if not exists session_variables (
  session_id   uuid not null references sessions(id) on delete cascade,
  name         text not null,
  value_text   text,
  value_number double precision,
  recorded_at  timestamptz not null default now(),
  primary key (session_id, name)
);

-- --------------------------------------------------------------------------
-- Quality outcomes
-- --------------------------------------------------------------------------
--
-- One row per check per session, kept whether it passed or failed. Keeping the
-- passes is what makes the failure rate a rate rather than a count.
create table if not exists quality_flags (
  session_id    uuid not null references sessions(id) on delete cascade,
  question_code text not null,
  kind          text not null,
  passed        boolean not null,
  detail        text,
  recorded_at   timestamptz not null default now(),
  primary key (session_id, question_code)
);

create index if not exists quality_flags_failed_idx
  on quality_flags (session_id) where not passed;

alter table study_variables   enable row level security;
alter table session_variables enable row level security;
alter table quality_flags     enable row level security;
