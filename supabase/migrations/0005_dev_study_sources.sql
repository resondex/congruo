-- Widen the development studies to the sources the instrument actually
-- measures.
--
-- These were seeded with search and ChatGPT only, which predates AI answer
-- capture. A study that excludes google_ai_mode drops every answer at parse
-- time, so the review step could not be exercised locally against the thing it
-- exists to show. Development studies only - a real fielding sets its own
-- sources from what the respondent was asked to consent to.

update studies
set sources = array[
  'google_search',
  'google_ai_mode',
  'google_image_search',
  'google_video_search',
  'google_hotels',
  'google_shopping',
  'gemini',
  'chatgpt'
]
where slug in ('dev', 'dev-append');
