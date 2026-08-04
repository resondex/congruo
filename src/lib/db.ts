import 'server-only'
import postgres from 'postgres'

/**
 * Direct Postgres connection.
 *
 * We talk to the database, not to the Data API. Congruo has no browser client,
 * no auth, and no RLS policies, so PostgREST was a browser-facing layer we
 * carried without using - and every fix for it (exposed schemas, grants to API
 * roles, schema-cache reloads) made the database *more* reachable. Going direct
 * means the Data API can stay switched off entirely.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a leaked connection string.
 */

let client: postgres.Sql | null = null

export function db(): postgres.Sql {
  if (client) return client

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set.')
  }

  client = postgres(url, {
    // Transaction-mode pooling hands the connection to another client between
    // statements, so session-level prepared statements cannot be reused.
    prepare: false,
    // Serverless invocations are short and numerous; a small pool per instance
    // avoids exhausting the pooler.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return client
}

/**
 * Lets routes degrade to validate-only instead of failing on a machine that
 * has not been pointed at a database yet.
 */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}
