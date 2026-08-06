import 'server-only'
import { cache } from 'react'
import { randomBytes, createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { db, dbConfigured } from './db'
import { hashPassword, verifyPassword } from './password'

export { hashPassword, verifyPassword }

/**
 * Accounts for the people who run studies.
 *
 * Respondents have no account and must never need one - see the header of
 * migration 0014. Nothing in this file may be imported by a page under
 * /s/[study] or /capture.
 *
 * Hashing lives in ./password so the account-creation script can share it.
 */

const SESSION_COOKIE = 'congruo_session'
const SESSION_DAYS = 14

export type Role = 'staff' | 'client_admin' | 'client_viewer'

export interface User {
  id: string
  email: string
  name: string | null
  role: Role
  orgId: string | null
  orgName?: string | null
}

/** Emails are compared and stored lowercased; case is not identity. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase()

/** Only the hash is stored, so a database dump does not contain live tokens. */
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export function newToken() {
  return randomBytes(32).toString('base64url')
}

export async function createSession(userId: string, userAgent?: string) {
  const token = newToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)

  await db()`
    insert into auth_sessions (token_hash, user_id, expires_at, user_agent)
    values (${tokenHash(token)}, ${userId}, ${expires}, ${userAgent ?? null})
  `

  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Set on any real deployment; left off on plain-http localhost so the
    // flow is testable without a certificate.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  })
  return token
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token && dbConfigured()) {
    await db()`delete from auth_sessions where token_hash = ${tokenHash(token)}`
  }
  jar.delete(SESSION_COOKIE)
}

interface UserRow {
  id: string
  email: string
  name: string | null
  role: Role
  org_id: string | null
  org_name: string | null
}

/**
 * The signed-in user, or null. Expired sessions are treated as absent and
 * cleaned up as they are encountered rather than by a scheduled job.
 *
 * Wrapped in React's cache so it runs once per request however many components
 * ask. The layout guards and the page then re-reads it, which was two round
 * trips to a database 40ms away for the same row - and two stamp writes with
 * it. Nothing here is memoised across requests: the cache is per render.
 */
export const currentUser = cache(async function currentUser(): Promise<User | null> {
  if (!dbConfigured()) return null

  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null

  const rows = await db()<UserRow[]>`
    select u.id, u.email, u.name, u.role, u.org_id, o.name as org_name
    from auth_sessions s
    join users u on u.id = s.user_id
    left join orgs o on o.id = u.org_id
    where s.token_hash = ${tokenHash(token)}
      and s.expires_at > now()
      and u.disabled_at is null
    limit 1
  `
  if (!rows.length) return null

  const row = rows[0]
  // Both stamps, and not awaited: the session's is for spotting a stale
  // cookie, the user's is what the People page shows. Updating only the first
  // meant every account read "never seen" forever.
  void db()`
    update auth_sessions set last_seen_at = now()
    where token_hash = ${tokenHash(token)}
  `.catch(() => {})
  void db()`
    update users set last_seen_at = now() where id = ${row.id}
  `.catch(() => {})

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    orgId: row.org_id,
    orgName: row.org_name,
  }
})

export const isStaff = (user: User) => user.role === 'staff'
export const canEditStudies = (user: User) =>
  user.role === 'staff' || user.role === 'client_admin'

/**
 * Whether a user may see a study, given the study's owning org.
 *
 * Fails closed in both directions that matter: a client with no org sees
 * nothing, and an unowned study is visible to staff only. The wrong answer
 * here shows one client another client's respondents, so it is written once,
 * used everywhere, and never inlined at a call site.
 */
export function canSeeOrg(user: User, orgId: string | null): boolean {
  if (user.role === 'staff') return true
  if (!user.orgId) return false
  return orgId === user.orgId
}

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw new Error('Not signed in.')
  return user
}
