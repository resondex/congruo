-- The three claim-bearing types.
--
-- date       when they last did something, against the most recent record
-- ranking    their order of use, against the order by record count
-- allocation how their activity splits, against the share of records
--
-- These are the types that extend what can be reconciled rather than what can
-- be asked, which is why they arrive together.

alter table survey_questions drop constraint if exists survey_questions_type_check;
alter table survey_questions add constraint survey_questions_type_check
  check (type in (
    -- Answerable
    'single', 'multiple', 'scale', 'number', 'text',
    'date', 'ranking', 'allocation',
    -- Shown, not asked
    'section', 'description', 'media', 'terminal'
  ));
