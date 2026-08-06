-- Branching rules referenced options by their old author-written value.
-- Options are numeric codes now, so the rules have to say so too.
--
-- Done as a recursive walk rather than by hand because a rule can nest, and
-- because this has to hold for any study that already exists rather than for
-- the development one I happen to be looking at. A rule left pointing at
-- "chatgpt" would not error - it would simply never match, which is the
-- failure this project keeps finding and which looks exactly like nobody
-- qualifying.

create or replace function recode_rule(rule jsonb, study text) returns jsonb as $$
declare
  recoded jsonb;
  item    jsonb;
  branch  text;
  code    int;
begin
  if rule is null or jsonb_typeof(rule) <> 'object' then
    return rule;
  end if;

  -- Combinators: recurse into each arm.
  foreach branch in array array['all', 'any'] loop
    if rule ? branch then
      recoded := '[]'::jsonb;
      for item in select * from jsonb_array_elements(rule -> branch) loop
        recoded := recoded || jsonb_build_array(recode_rule(item, study));
      end loop;
      return jsonb_build_object(branch, recoded);
    end if;
  end loop;

  if rule ? 'not' then
    return jsonb_build_object('not', recode_rule(rule -> 'not', study));
  end if;

  -- A single test. Only the operators that compare against an option need
  -- recoding; a numeric threshold means what it says.
  if rule ? 'q' and rule ? 'value'
     and rule ->> 'op' in ('is', 'is_not', 'includes', 'excludes') then
    select (o ->> 'code')::int into code
    from survey_questions q
    cross join lateral jsonb_array_elements(q.options) o
    where q.study_slug = study
      and q.code = rule ->> 'q'
      and o ->> 'mapsTo' = rule ->> 'value'
    limit 1;

    if code is not null then
      return jsonb_set(rule, '{value}', to_jsonb(code));
    end if;
  end if;

  return rule;
end;
$$ language plpgsql;

update survey_questions
set show_if = recode_rule(show_if, study_slug)
where show_if is not null;

update survey_questions
set terminate_if = recode_rule(terminate_if, study_slug)
where terminate_if is not null;

-- One-shot. Leaving it behind would be a function nobody remembers owning.
drop function recode_rule(jsonb, text);
