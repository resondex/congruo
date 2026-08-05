-- Branching and skip logic.
--
-- `show_if` decides whether a question is asked at all. `terminate_if` ends
-- the interview when the respondent turns out not to qualify - the screen-out
-- half of skip logic, evaluated when they leave the page the question is on.
--
-- Both are conditions in the small closed language in src/lib/conditions.ts:
--
--   {"q":"q3_insurance","op":"is","value":"yes"}
--   {"all":[{"q":"q1","op":"includes","value":"chatgpt"},
--           {"q":"q2","op":"gte","value":10}]}
--   {"not":{"q":"q1","op":"includes","value":"none"}}
--
-- A condition may only reference questions that come earlier by `position`.
-- Nothing enforces that in the schema - it is checked when the instrument is
-- loaded - but authoring one that looks forward produces a branch that can
-- never fire, so it is worth stating here where questionnaires get written.

alter table survey_questions
  add column if not exists show_if      jsonb,
  add column if not exists terminate_if jsonb;

comment on column survey_questions.show_if is
  'Condition on earlier answers; the question is skipped when it is false.';
comment on column survey_questions.terminate_if is
  'Condition on earlier answers; the interview ends when it is true.';

-- Set when a respondent is screened out. Distinct from declined_at: declining
-- is a choice about sharing, being screened out is us deciding they are not in
-- scope. Counting the second as the first would understate willingness to
-- share, which is the number the whole model rests on.
alter table sessions
  add column if not exists screened_out_at timestamptz;
