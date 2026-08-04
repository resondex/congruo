import 'server-only'
import { supabaseAdmin } from './supabase/server'
import type { SourceKind } from './records'

/**
 * Session persistence.
 *
 * A session is one respondent working through one study. In append mode it is
 * identified by the referring platform's respondent id, so both hops of the
 * redirect land on the same row.
 */

export interface SessionRow {
  id: string
  study_slug: string
  external_respondent_id: string | null
}

/**
 * Append mode sends the respondent to us twice, so the second hop has to find
 * the row the first hop created rather than opening a new one. Full-service
 * sessions have no external id and always get a fresh row.
 */
export async function findOrCreateSession(
  studySlug: string,
  externalRespondentId?: string
): Promise<SessionRow> {
  const db = supabaseAdmin()

  if (externalRespondentId) {
    const { data: existing, error } = await db
      .from('sessions')
      .select('id, study_slug, external_respondent_id')
      .eq('study_slug', studySlug)
      .eq('external_respondent_id', externalRespondentId)
      .maybeSingle()

    if (error) throw new Error(`Session lookup failed: ${error.message}`)
    if (existing) return existing as SessionRow
  }

  const { data, error } = await db
    .from('sessions')
    .insert({
      study_slug: studySlug,
      external_respondent_id: externalRespondentId ?? null,
    })
    .select('id, study_slug, external_respondent_id')
    .single()

  if (error) throw new Error(`Session create failed: ${error.message}`)
  return data as SessionRow
}

export interface ConsentGrant {
  source: SourceKind
  granted: boolean
}

/**
 * Grants are append-only. A respondent who changes their mind produces a new
 * row, so the sequence of decisions is the audit trail.
 */
export async function recordConsent(
  sessionId: string,
  grants: ConsentGrant[],
  disclosureVersion: string,
  comprehensionPassed: boolean
): Promise<void> {
  if (!grants.length) return

  const { error } = await supabaseAdmin()
    .from('consent_grants')
    .insert(
      grants.map((g) => ({
        session_id: sessionId,
        source: g.source,
        granted: g.granted,
        disclosure_version: disclosureVersion,
        comprehension_passed: comprehensionPassed,
      }))
    )

  if (error) throw new Error(`Consent write failed: ${error.message}`)
}

export interface ReleaseInput {
  sessionId: string
  records: {
    source: string
    timestamp: string
    text: string
    context?: string
  }[]
  withheldCount: number
}

export interface ReleaseReceipt {
  releasedCount: number
  withheldCount: number
  sources: string[]
  earliest: string | null
  latest: string | null
}

export async function persistRelease(
  input: ReleaseInput
): Promise<ReleaseReceipt> {
  const db = supabaseAdmin()

  const sources = [...new Set(input.records.map((r) => r.source))]
  const timestamps = input.records.map((r) => r.timestamp).sort()
  const receipt: ReleaseReceipt = {
    releasedCount: input.records.length,
    withheldCount: input.withheldCount,
    sources,
    earliest: timestamps[0] ?? null,
    latest: timestamps[timestamps.length - 1] ?? null,
  }

  if (input.records.length) {
    // Chunked so a large archive does not hit the request size limit.
    const CHUNK = 500
    for (let i = 0; i < input.records.length; i += CHUNK) {
      const { error } = await db.from('released_records').insert(
        input.records.slice(i, i + CHUNK).map((r) => ({
          session_id: input.sessionId,
          source: r.source,
          occurred_at: r.timestamp,
          text: r.text,
          context: r.context ?? null,
        }))
      )
      if (error) throw new Error(`Record write failed: ${error.message}`)
    }
  }

  const { error: receiptError } = await db.from('release_receipts').insert({
    session_id: input.sessionId,
    released_count: receipt.releasedCount,
    withheld_count: receipt.withheldCount,
    sources: receipt.sources,
    earliest: receipt.earliest,
    latest: receipt.latest,
  })
  if (receiptError) {
    throw new Error(`Receipt write failed: ${receiptError.message}`)
  }

  // A release of zero records is a decline, not a completion: the respondent
  // reached the review step and chose to share nothing. Marking it as such is
  // what keeps donation-selection bias measurable.
  const stamp = new Date().toISOString()
  const { error: sessionError } = await db
    .from('sessions')
    .update(
      receipt.releasedCount > 0 ? { released_at: stamp } : { declined_at: stamp }
    )
    .eq('id', input.sessionId)
  if (sessionError) {
    throw new Error(`Session update failed: ${sessionError.message}`)
  }

  return receipt
}

export async function markDeclined(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('sessions')
    .update({ declined_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) throw new Error(`Decline write failed: ${error.message}`)
}
