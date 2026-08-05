-- A questionnaire for the development study.
--
-- Five questions, one of each type, each bound to a claim so the shape a real
-- instrument takes is visible. Entirely synthetic - it is a demonstration
-- instrument, not one that has been fielded.
--
-- dev-append deliberately gets none: its interview belongs to the client.

insert into survey_questions (
  study_slug, code, position, page, type, prompt, help,
  options, required, min_value, max_value, min_label, max_label, claim
)
values
  (
    'dev', 'q1_sources_used', 1, 0, 'multiple',
    'Which of these have you used in the last 30 days?',
    'Choose all that apply.',
    '[{"value":"google_search","label":"Google search"},
      {"value":"google_ai_mode","label":"Google AI Mode"},
      {"value":"chatgpt","label":"ChatGPT"},
      {"value":"gemini","label":"Gemini"},
      {"value":"none","label":"None of these"}]'::jsonb,
    true, null, null, null, null,
    '{"kind":"source_use"}'::jsonb
  ),
  (
    'dev', 'q2_ai_frequency', 2, 1, 'number',
    'Roughly how many times did you ask an AI assistant something in the last 30 days?',
    'A best estimate is fine.',
    '[]'::jsonb, true, 0, 1000, null, null,
    '{"kind":"search_frequency",
      "sources":["google_ai_mode","chatgpt","gemini"],
      "windowDays":30}'::jsonb
  ),
  (
    'dev', 'q3_insurance', 3, 1, 'single',
    'In the last 30 days, did you look into insurance of any kind?',
    null,
    '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]'::jsonb,
    true, null, null, null, null,
    '{"kind":"topic_search",
      "terms":["insurance","premium","deductible","coverage","policy"],
      "windowDays":30}'::jsonb
  ),
  (
    'dev', 'q4_trust', 4, 2, 'scale',
    'How much do you trust the answers AI assistants give you?',
    null,
    '[]'::jsonb, true, 1, 7, 'Not at all', 'Completely', null
  ),
  (
    'dev', 'q5_last_lookup', 5, 3, 'text',
    'What is the last thing you looked up that actually mattered to you?',
    'A sentence is plenty. Skip it if you would rather not say.',
    '[]'::jsonb, false, null, null, null, null, null
  )
on conflict (study_slug, code) do nothing;
