import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'
import { hashPassword } from './password'
import { newToken, type Role, type User } from './auth'

/**
 * Password resets.
 *
 * An admin issues a link rather than setting a password. The person chooses
 * their own and the admin never learns it - a password an administrator knows
 * is a password two people know, and the recovery story should not be worse
 * than the login story.
 */

const RESET_HOURS = 24

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * Who may reset whom.
 *
 * Staff can reset anyone. A client admin can reset people in their own org but
 * never a staff account - otherwise resetting the right account would hand
 * them every other client's data, which is the same escalation the invite
 * rules refuse.
 */
export function canReset(
  actor: User,
  target: { role: Role; orgId: string | null }
): boolean {
  if (actor.role === 'staff') return true
  if (actor.role !== 'client_admin' || !actor.orgId) return false
  if (target.role === 'staff') return false
  return target.orgId === actor.orgId
}

export async function createReset(
  actor: User,
  userId: string
): Promise<{ token: string; email: string } | { error: string }> {
  const sql = db()
  const rows = await sql<
    { id: string; email: string; role: Role; org_id: string | null }[]
  >`select id, email, role, org_id from users where id = ${userId} limit 1`
  if (!rows.length) return { error: 'No such account.' }

  const target = rows[0]
  if (!canReset(actor, { role: target.role, orgId: target.org_id })) {
    return { error: 'You cannot reset that account.' }
  }

  // Any older link stops working the moment a new one is issued, so a reset
  // handed to the wrong person can be revoked by issuing another.
  await sql`
    update password_resets set used_at = now()
    where user_id = ${userId} and used_at is null
  `

  const token = newToken()
  await sql`
    insert into password_resets (token_hash, user_id, created_by, expires_at)
    values (
      ${hashOf(token)}, ${userId}, ${actor.id},
      ${new Date(Date.now() + RESET_HOURS * 3600_000)}
    )
  `
  return { token, email: target.email }
}

export async function readReset(token: string): Promise<{ email: string } | null> {
  const rows = await db()<{ email: string }[]>`
    select u.email
    from password_resets r
    join users u on u.id = r.user_id
    where r.token_hash = ${hashOf(token)}
      and r.used_at is null
      and r.expires_at > now()
      and u.disabled_at is null
    limit 1
  `
  return rows.length ? { email: rows[0].email } : null
}

/**
 * Spends a reset token: sets the password and signs every other session out.
 *
 * Named for what it does to the token rather than "use", which reads as a
 * React hook to both linters and people.
 *
 * Ending the old sessions is the point of a reset: the usual reason for one is
 * that somebody else may have the account, and leaving their cookie working
 * would make the reset cosmetic.
 */
export async function consumeReset(
  token: string,
  password: string
): Promise<{ userId: string } | { error: string }> {
  if (password.length < 12) return { error: 'Use at least 12 characters.' }

  const sql = db()
  const { hash, salt } = await hashPassword(password)

  return sql.begin(async (tx) => {
    const rows = await tx<{ user_id: string }[]>`
      update password_resets set used_at = now()
      where token_hash = ${hashOf(token)}
        and used_at is null
        and expires_at > now()
      returning user_id
    `
    if (!rows.length) return { error: 'That reset link is no longer valid.' }

    const userId = rows[0].user_id
    await tx`
      update users set password_hash = ${hash}, password_salt = ${salt}
      where id = ${userId}
    `
    await tx`delete from auth_sessions where user_id = ${userId}`
    return { userId }
  })
}
