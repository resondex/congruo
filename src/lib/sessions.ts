import 'server-only'
import { db } from './db'
import type { SourceKind } from './records'

/**
 * Session persistence.
 *
 * A session is one respondent working through one study. In append mode it is
 * identified by the referring platform's respondent id, so both hops of the
 * redirect land on the same row.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SessionRow {
  id: string
  study_slug: string
  external_respondent_id: string | null
}

/**
 * Resolves the session a request belongs to, creating one if needed.
 *
 * Both modes have to land every step of one respondent's journey on a single
 * row, by different means. Append mode is keyed on the referring platform's
 * respondent id, which arrives on both hops. Full-service respondents have no
 * such id, so the client carries the session id we hand back at consent.
 *
 * Getting this wrong is not a cosmetic bug: consent, survey and release
 * scattered across three rows means survey answers cannot be joined to
 * released records, which is the measurement, and no one can be counted as
 * having answered but declined, which is invariant 3.
 */
export async function findOrCreateSession(
  studySlug: string,
  externalRespondentId?: string,
  sessionId?: string
): Promise<SessionRow> {
  const sql = db()

  // Checked before it reaches Postgres: a malformed id is a stale or hand-typed
  // value, and comparing it to a uuid column would raise rather than miss.
  if (sessionId && !UUID.test(sessionId)) sessionId = undefined

  if (sessionId) {
    // Matched on the study as well as the id, so a session id cannot be used
    // to write into a different study's fielding.
    const existing = await sql<SessionRow[]>`
      select id, study_slug, external_respondent_id
      from sessions
      where id = ${sessionId} and study_slug = ${studySlug}
      limit 1
    `
    if (existing.length) return existing[0]

    // An id we do not recognise means the respondent's earlier rows are
    // unreachable whatever we do - a wiped database, or a link shared to a
    // different deployment. Opening a fresh session at least keeps what they
    // are doing now, where refusing would lose that too.
    console.warn('unknown session id for study', studySlug)
  }

  if (externalRespondentId) {
    const existing = await sql<SessionRow[]>`
      select id, study_slug, external_respondent_id
      from sessions
      where study_slug = ${studySlug}
        and external_respondent_id = ${externalRespondentId}
      limit 1
    `
    if (existing.length) return existing[0]
  }

  const created = await sql<SessionRow[]>`
    insert into sessions (study_slug, external_respondent_id)
    values (${studySlug}, ${externalRespondentId ?? null})
    returning id, study_slug, external_respondent_id
  `
  return created[0]
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

  const sql = db()
  await sql`
    insert into consent_grants ${sql(
      grants.map((g) => ({
        session_id: sessionId,
        source: g.source,
        granted: g.granted,
        disclosure_version: disclosureVersion,
        comprehension_passed: comprehensionPassed,
      }))
    )}
  `
}

export interface ReleaseInput {
  sessionId: string
  records: {
    source: string
    timestamp: string
    text: string
    context?: string
    answer?: string
    citations?: string[]
  }[]
  withheldCount: number
}

export interface ReleaseReceipt {
  releasedCount: number
  withheldCount: number
  answerCount: number
  sources: string[]
  earliest: string | null
  latest: string | null
}

export async function persistRelease(
  input: ReleaseInput
): Promise<ReleaseReceipt> {
  const sql = db()

  const sources = [...new Set(input.records.map((r) => r.source))]
  const timestamps = input.records.map((r) => r.timestamp).sort()
  const receipt: ReleaseReceipt = {
    releasedCount: input.records.length,
    withheldCount: input.withheldCount,
    answerCount: input.records.filter((r) => r.answer).length,
    sources,
    earliest: timestamps[0] ?? null,
    latest: timestamps[timestamps.length - 1] ?? null,
  }

  // One transaction: either the records, the receipt, and the session stamp
  // all land, or none do. A half-written release would misreport to the
  // respondent what we hold.
  await sql.begin(async (tx) => {
    if (input.records.length) {
      const CHUNK = 500
      for (let i = 0; i < input.records.length; i += CHUNK) {
        const rows = input.records.slice(i, i + CHUNK).map((r) => ({
          session_id: input.sessionId,
          source: r.source,
          occurred_at: r.timestamp,
          text: r.text,
          context: r.context ?? null,
          answer: r.answer ?? null,
          citations: r.citations ?? null,
        }))
        await tx`insert into released_records ${tx(rows)}`
      }
    }

    await tx`
      insert into release_receipts
        (session_id, released_count, withheld_count, sources, earliest, latest)
      values (
        ${input.sessionId}, ${receipt.releasedCount}, ${receipt.withheldCount},
        ${receipt.sources}, ${receipt.earliest}, ${receipt.latest}
      )
    `

    // A release of zero records is a decline, not a completion: the respondent
    // reached the review step and chose to share nothing. Marking it as such is
    // what keeps donation-selection bias measurable.
    if (receipt.releasedCount > 0) {
      await tx`update sessions set released_at = now() where id = ${input.sessionId}`
    } else {
      await tx`update sessions set declined_at = now() where id = ${input.sessionId}`
    }
  })

  return receipt
}
