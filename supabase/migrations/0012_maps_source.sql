-- Google Maps.
--
-- Its own consent item rather than part of "Google search activity". Looking a
-- place up is a search, but the record it leaves is where someone went, and
-- that is a different thing to hand over than what they typed into a search
-- box. A respondent who is happy to share queries may well not be happy to
-- share a map of their movements, and rolling the two together would take that
-- decision away from them without anyone noticing.

update studies
set sources = sources || array['google_maps']
where slug in ('dev', 'dev-append')
  and not (sources @> array['google_maps']);
