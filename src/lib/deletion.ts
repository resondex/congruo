import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'
import { newToken } from './auth'

/**
 * Honouring "you can ask us to delete everything at any time".
 *
 * The token is the whole design. We hold nothing that identifies a respondent,
 * which is a property worth keeping and which also means a request arriving by
 * email cannot be matched to a row or shown to be genuine. A token issued at
 * the end does both, and tells us nothing about them we did not already know.
 */

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Issues the token for a session, once.
 *
 * Called as the release is receipted. Re-issuing on a later release would
 * invalidate a token the respondent may already have written down, so an
 * existing one is left alone and returned as null - the caller shows what it
 * has rather than replacing it.
 */
export async function issueDeletionToken(
  sessionId: string
): Promise<string | null> {
  const token = newToken()
  const rows = await db()<{ id: string }[]>`
    update sessions set deletion_token_hash = ${hashOf(token)}
    where id = ${sessionId} and deletion_token_hash is null
    returning id
  `
  return rows.length ? token : null
}

export interface Holding {
  sessionId: string
  studyName: string
  startedAt: string
  records: number
  answers: number
  hasReconciled: boolean
  alreadyDeleted: boolean
}

/**
 * What we hold for a token, so it can be shown before anything is destroyed.
 *
 * Deletion is irreversible and unconfirmable afterwards - there is no account
 * to log back into and check. Showing the count first is the only chance the
 * respondent gets to see that the token is the right one.
 */
export async function holdingFor(token: string): Promise<Holding | null> {
  const rows = await db()<
    {
      id: string
      name: string
      created_at: string
      deleted_at: string | null
      reconciled_at: string | null
      records: number
      answers: number
    }[]
  >`
    select s.id, t.name, s.created_at, s.deleted_at, s.reconciled_at,
           (select count(*) from released_records r where r.session_id = s.id)::int as records,
           (select count(*) from survey_answers a where a.session_id = s.id)::int as answers
    from sessions s
    join studies t on t.slug = s.study_slug
    where s.deletion_token_hash = ${hashOf(token)}
    limit 1
  `
  if (!rows.length) return null
  const r = rows[0]
  return {
    sessionId: r.id,
    studyName: r.name,
    startedAt: r.created_at,
    records: r.records,
    answers: r.answers,
    hasReconciled: Boolean(r.reconciled_at),
    alreadyDeleted: Boolean(r.deleted_at),
  }
}

/**
 * Removes everything held for a session, leaving a tombstone.
 *
 * One transaction: a half-finished deletion is the worst of both outcomes,
 * where the respondent has been told their data is gone and some of it is not.
 *
 * The stage stamps are cleared along with the content. Keeping "released_at"
 * would be keeping a fact about the person, and the study's own counts should
 * fall when we stop holding something - a number that stays up after a
 * deletion is a claim to still have it.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const sql = db()
  await sql.begin(async (tx) => {
    // Most of these cascade from the session row, but the session row is what
    // survives - so each is removed explicitly rather than relying on a delete
    // that is not going to happen.
    await tx`delete from survey_answers    where session_id = ${sessionId}`
    await tx`delete from released_records  where session_id = ${sessionId}`
    await tx`delete from release_receipts  where session_id = ${sessionId}`
    await tx`delete from reconcile_responses where session_id = ${sessionId}`
    await tx`delete from session_variables where session_id = ${sessionId}`
    await tx`delete from quality_flags     where session_id = ${sessionId}`
    await tx`delete from consent_grants    where session_id = ${sessionId}`

    await tx`
      update sessions set
        deleted_at      = now(),
        survey_done_at  = null,
        released_at     = null,
        declined_at     = null,
        screened_out_at = null,
        reconciled_at   = null,
        -- Spent. The token cannot be used again, and cannot be used to check
        -- afterwards whether the deletion happened - which is a small loss
        -- against a token that stays live forever.
        deletion_token_hash = null
      where id = ${sessionId}
    `
  })
}
