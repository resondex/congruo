import 'server-only'
import { db, dbConfigured } from './db'

/**
 * A fixed-window counter, kept in Postgres.
 *
 * Not in memory: this deploys to serverless, where an in-process counter means
 * "N attempts per instance the load balancer happens to pick" - which is not a
 * limit at all. One round trip per guarded request is the price of the endpoint
 * not being free to hammer.
 *
 * Fixed window rather than a sliding one because the failure mode is mild: at
 * worst someone gets a double allowance across a window boundary. A sliding
 * window costs more storage and more thinking for a bound that is already
 * approximate.
 */

export interface Limit {
  ok: boolean
  /** Seconds until the window resets. Only meaningful when ok is false. */
  retryAfter: number
}

const ALLOWED: Limit = { ok: true, retryAfter: 0 }

/**
 * Counts one hit against `key` and says whether it is still under `limit`.
 *
 * Fails open when the database is unreachable. That is a deliberate trade: a
 * rate limiter that takes the whole login page down when Postgres hiccups has
 * caused a worse outage than the attack it was defending against.
 */
export async function hit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<Limit> {
  if (!dbConfigured()) return ALLOWED

  try {
    const rows = await db()<{ count: number; window_start: Date }[]>`
      insert into rate_limits (key, window_start, count)
      values (${key}, now(), 1)
      on conflict (key) do update set
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          then now() else rate_limits.window_start end,
        count = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          then 1 else rate_limits.count + 1 end
      returning count, window_start
    `
    const { count, window_start } = rows[0]
    if (count <= limit) return ALLOWED

    const resetsAt = new Date(window_start).getTime() + windowSeconds * 1000
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((resetsAt - Date.now()) / 1000)),
    }
  } catch {
    return ALLOWED
  }
}

/**
 * Clears the counter for a key.
 *
 * Called after a successful sign-in so that someone who mistyped their
 * password four times and then got it right is not still one attempt from a
 * lockout. Only successes clear it; failures are what the counter is for.
 */
export async function clear(key: string): Promise<void> {
  if (!dbConfigured()) return
  try {
    await db()`delete from rate_limits where key = ${key}`
  } catch {
    // A counter that failed to clear expires on its own.
  }
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * Vercel sets x-forwarded-for and strips any client-supplied copy, so the first
 * hop is trustworthy there. Elsewhere it is a hint, which is why the limits
 * that matter are keyed on the account as well.
 */
export function callerIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') ?? 'unknown'
}

/** Old windows are dead weight. Swept now and then rather than by a cron. */
export async function sweep(): Promise<void> {
  if (!dbConfigured() || Math.random() > 0.01) return
  try {
    await db()`delete from rate_limits where window_start < now() - interval '1 day'`
  } catch {
    // Not worth reporting: it runs again on the next request.
  }
}
