-- YouTube.
--
-- Two sources rather than one. Watching and engaging arrive in a single
-- Takeout file, but they are not equally sensitive: "watched this video" and
-- "disliked this political channel" are different things to hand over, and a
-- study measuring search behaviour should be able to ask for the first without
-- collecting the second. They are one item at consent and two at review.

update studies
set sources = sources || array['youtube', 'youtube_engagement']
where slug in ('dev', 'dev-append')
  and not (sources @> array['youtube']);
