-- Foundations for the wider question set.
--
-- Three changes, and the first is the one with teeth.
--
-- 1. OPTIONS GET IMMUTABLE NUMERIC CODES.
--
-- An option was {value, label}, where the value was author-written and doubled
-- as the analysis key. That is the arrangement where renaming a label quietly
-- changes what a column means. Now an option is {code, label, mapsTo}: the code
-- is assigned once and never edited, the label is free to change as often as
-- the wording needs, and mapsTo is a separate binding used only by the claim
-- engine to say "this option means Google AI Mode".
--
-- Separating the last two is what lets both rules hold at once: the data file
-- is stable integers, and a question can still be bound to a source.
--
-- Reserved codes, immutable, excluded from bases by default:
--   97  Other, please specify
--   98  Prefer not to say
--
-- 2. ANSWERS NEED SHAPES BEYOND A STRING OR A NUMBER.
--
-- Ranking is an ordered list, allocation is a map of code to quantity, and a
-- matrix is one answer per row. value_json carries the first two; row_code
-- carries the third.
--
-- 3. MATRIX IS A MODIFIER, NOT A TYPE.
--
-- A matrix is the same question asked about each of several things, so it is a
-- list of rows attached to an ordinary question rather than a parallel family
-- of matrix-shaped types. It also means a grid can be rendered as a stacked
-- list on a phone without any change to the data.

-- --------------------------------------------------------------------------
-- Questions
-- --------------------------------------------------------------------------

alter table survey_questions
  -- [{code, label, mapsTo}] for a matrix's rows; null when not a matrix.
  add column if not exists matrix_rows jsonb,
  add column if not exists allow_other boolean not null default false,
  add column if not exists allow_prefer_not_to_say boolean not null default false,
  add column if not exists min_selections integer,
  add column if not exists max_selections integer;

comment on column survey_questions.options is
  '[{code:int, label:text, mapsTo:text?}] - code is immutable, label is not.';
comment on column survey_questions.matrix_rows is
  'Rows this question is repeated over. Same shape as options. Null when not a matrix.';

-- Rewrite existing {value,label} options into {code,label,mapsTo}. The old
-- value becomes mapsTo, which is exactly what it was being used for, and the
-- code is its position - stable from here on.
update survey_questions
set options = (
  select jsonb_agg(
    jsonb_build_object(
      'code', ord,
      'label', coalesce(elem->>'label', elem->>'value'),
      'mapsTo', elem->>'value'
    )
    order by ord
  )
  from jsonb_array_elements(options) with ordinality as t(elem, ord)
)
where jsonb_array_length(coalesce(options, '[]'::jsonb)) > 0
  and options->0 ? 'value';

-- --------------------------------------------------------------------------
-- Answers
-- --------------------------------------------------------------------------

alter table survey_answers
  -- Selection, as the immutable codes rather than as author-written strings.
  add column if not exists value_codes integer[],
  -- Ranking: [3,1,2]. Allocation: {"1": 40, "2": 60}. Anything else shaped.
  add column if not exists value_json jsonb,
  -- Which matrix row this answer is for. 0 means the question is not a matrix,
  -- so row codes start at 1 - a null here would defeat the unique index, since
  -- Postgres treats nulls as distinct.
  add column if not exists row_code integer not null default 0;

-- Existing selections carried the old author-written values. Map each to the
-- code its option now has, joining through the session to reach the study.
update survey_answers a
set value_codes = (
  select array_agg((o->>'code')::int order by (o->>'code')::int)
  from survey_questions q
  join sessions s on s.study_slug = q.study_slug
  cross join lateral jsonb_array_elements(q.options) o
  where s.id = a.session_id
    and q.code = a.question_code
    and o->>'mapsTo' = any(a.value_choices)
)
where a.value_choices is not null
  and a.value_codes is null;

-- One answer per question per row, rather than per question.
alter table survey_answers drop constraint if exists survey_answers_session_id_question_code_key;
create unique index if not exists survey_answers_one_per_row
  on survey_answers (session_id, question_code, row_code);
