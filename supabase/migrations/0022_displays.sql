-- The rest of the rating and selection families.
--
-- Most of them are the same datum drawn differently: a star rating, a slider, a
-- smiley face, a thermometer and a numbered scale all store one number in a
-- range. Making each a type would mean a validator, a storage shape and a
-- reconcile branch per widget, all identical, and they would drift.
--
-- So the widget is a property. `display` chooses how a scale or a selection is
-- drawn; the answer, the validation and the comparison are unchanged. Same
-- reasoning as matrix being a modifier rather than a family of grid types.
--
-- Two are genuinely different data and are types:
--
--   polar    a forced choice between two poles - the same construct as the
--            polar batteries in a segmentation spec, so a study can feed one
--            without a recode
--   overlap  two circles the respondent slides together, from -100 fully apart
--            to +100 fully overlapping. A continuous form of the Inclusion of
--            Other in the Self scale, which has been used since 1992 with seven
--            fixed pictures.

alter table survey_questions drop constraint if exists survey_questions_type_check;
alter table survey_questions add constraint survey_questions_type_check
  check (type in (
    'single', 'multiple', 'scale', 'number', 'text',
    'date', 'ranking', 'allocation', 'polar', 'overlap',
    'section', 'description', 'media', 'terminal'
  ));

alter table survey_questions
  -- How to draw it. Null means the plain form of the type.
  add column if not exists display text,
  -- One label per point, in order. The values themselves are the positions and
  -- are never editable - that is the whole point of the split.
  add column if not exists point_labels jsonb,
  -- overlap: what sits in the fixed circle and what sits in the moving one.
  add column if not exists static_label text,
  add column if not exists static_image text,
  add column if not exists moving_label text;

comment on column survey_questions.display is
  'Widget for a type whose data is unchanged by it: stars, slider, smiley, thermometer, nps, dropdown, images.';
comment on column survey_questions.point_labels is
  'Label per scale point, in order. Labels are editable; the values they sit on are not.';
