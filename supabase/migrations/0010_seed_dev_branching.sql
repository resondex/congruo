-- Branching for the development study, so the logic is exercisable locally.
--
--   q2 (how many AI prompts)  asked only if an AI service was named in q1
--   q3 (insurance)            asked only if q2 is at least 5
--   q4 (trust in AI)          asked only if an AI service was named in q1
--   q5 (last lookup)          always asked
--
-- and a screen-out: someone who used none of these has nothing for this study
-- to measure, so the interview ends rather than collecting an archive we would
-- have no self-report to compare it against.

update survey_questions
set show_if = '{"any":[
      {"q":"q1_sources_used","op":"includes","value":"google_ai_mode"},
      {"q":"q1_sources_used","op":"includes","value":"chatgpt"},
      {"q":"q1_sources_used","op":"includes","value":"gemini"}
    ]}'::jsonb
where study_slug = 'dev' and code in ('q2_ai_frequency', 'q4_trust');

update survey_questions
set show_if = '{"all":[
      {"any":[
        {"q":"q1_sources_used","op":"includes","value":"google_ai_mode"},
        {"q":"q1_sources_used","op":"includes","value":"chatgpt"},
        {"q":"q1_sources_used","op":"includes","value":"gemini"}
      ]},
      {"q":"q2_ai_frequency","op":"gte","value":5}
    ]}'::jsonb
where study_slug = 'dev' and code = 'q3_insurance';

update survey_questions
set terminate_if = '{"q":"q1_sources_used","op":"includes","value":"none"}'::jsonb
where study_slug = 'dev' and code = 'q1_sources_used';
