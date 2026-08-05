-- AI answers and their citations.
--
-- Records from AI-mediated sources carry the answer the respondent was shown
-- and the sources it cited. Both are nullable: most records are plain searches
-- with neither.
--
-- These are held separately from `text` on purpose. A respondent can release
-- the query while withholding the answer - "I searched for this" and "here is
-- everything the AI told me about it" are different disclosures, and the review
-- step lets them be decided separately.

alter table released_records
  add column if not exists answer text,
  add column if not exists citations text[];

-- Which sources cited, across a study. This is the client-facing question, and
-- unnesting on every query would get expensive once a panel is fielded.
create index if not exists released_records_citations_idx
  on released_records using gin (citations);

comment on column released_records.answer is
  'AI-generated answer shown to the respondent, released separately from the query.';
comment on column released_records.citations is
  'Sources the answer cited, in the order shown.';
