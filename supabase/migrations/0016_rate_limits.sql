-- Rate limiting.
--
-- In Postgres rather than in memory because this deploys to serverless: an
-- in-process counter is per instance, so the limit would be "N attempts per
-- instance the load balancer happens to pick", which is not a limit.
--
-- One row per key per window. The cost is one round trip on the endpoints that
-- have one, which is the price of the endpoint not being free to hammer.

create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

-- Old windows are dead weight; swept opportunistically rather than by a job.
create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;
