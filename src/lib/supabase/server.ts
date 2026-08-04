import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client.
 *
 * `server-only` makes importing this from a client component a build error
 * rather than a leaked key. Every table has RLS enabled with no policies, so
 * this client is the only thing that can read or write - which is the point.
 */

let cached: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached

  // Deliberately not NEXT_PUBLIC_. Nothing in the browser talks to Supabase,
  // and a NEXT_PUBLIC_ name would imply a client that does not exist.
  const url = process.env.SUPABASE_URL
  // Supabase is retiring the service_role JWT in favour of sb_secret_ keys.
  // Both authorize through the same service_role Postgres role, so either
  // works and the grants migration is correct for both.
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.'
    )
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

/**
 * True when credentials are present. Lets routes degrade to validate-only
 * instead of 500ing on a machine that has not been pointed at a database yet.
 */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}
