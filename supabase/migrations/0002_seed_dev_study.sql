-- A study to develop against. Safe to apply anywhere: localhost is the only
-- permitted return host, so this row cannot redirect a respondent off-machine.

insert into studies (
  slug, name, mode, sources, return_hosts, respondent_param, status_param
)
values (
  'dev',
  'Development study',
  'full_service',
  array['google_search', 'chatgpt'],
  array['localhost'],
  'rid',
  'status'
)
on conflict (slug) do nothing;

-- An append-mode study for exercising the two-hop redirect locally.
insert into studies (
  slug, name, mode, sources, return_hosts, respondent_param, status_param
)
values (
  'dev-append',
  'Development study (append mode)',
  'append',
  array['google_search', 'chatgpt'],
  array['localhost'],
  'rid',
  'status'
)
on conflict (slug) do nothing;
