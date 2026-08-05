-- Where an AI answer's citations actually sat.
--
-- `citations` is a flat list: it says an answer cited four sources, not which
-- claim each one backed, and not how much of the answer cited nothing at all.
-- On a real archive that last number is the finding - 22 citations across
-- roughly 440 blocks, so the overwhelming majority of what the assistant
-- asserted was unattributed. A client asking which sources an assistant repeats
-- cannot get there from a list that has already discarded the positions.
--
-- One element per block of the answer, in order:
--   [{"text": "...", "citations": [{"url": "...", "text": "anchor words"}]}]
--
-- Passages with an empty citations array are the uncited ones, which is the
-- comparison this column exists to make possible.

alter table released_records
  add column if not exists passages jsonb;

comment on column released_records.passages is
  'Answer split into its blocks, each with the citations anchored inside it.';
