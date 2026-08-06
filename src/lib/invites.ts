import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'
import { hashPassword } from './password'
import { newToken, normaliseEmail, type Role, type User } from './auth'

/**
 * Invitations.
 *
 * The account-creation script is a bootstrap, not the mechanism: you need an
 * account before you can invite anyone, so the first one has to come from
 * outside the app. Everything after it happens here.
 *
 * The token is shown once, at creation, and only its hash is stored - so an
 * invite cannot be recovered from the database, by us or by anyone who takes a
 * copy of it. If it is lost, it is reissued.
 */

const INVITE_DAYS = 7

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

export interface Invite {
  email: string
  role: Role
  orgId: string | null
  orgName: string | null
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
}

/**
 * Who a given user may invite, and into where.
 *
 * A client admin can add people to their own organisation and cannot mint
 * staff. Without this an org admin could grant themselves the run of every
 * other client's data, which is the one privilege escalation this model has to
 * refuse.
 */
export function canInvite(user: User, role: Role, orgId: string | null): boolean {
  if (user.role === 'staff') {
    return role === 'staff' ? orgId === null : orgId !== null
  }
  if (user.role !== 'client_admin' || !user.orgId) return false
  if (role === 'staff') return false
  return orgId === user.orgId
}

/**
 * Creates an invite and returns the token exactly once.
 *
 * There is no mail sender configured yet - congruo.ai has no verified sending
 * domain - so the caller copies the link and sends it however they already
 * talk to the person. That is deliberate rather than unfinished: an invite
 * arriving through a channel the recipient already trusts is not obviously
 * worse than one arriving from a domain they have never seen.
 */
export async function createInvite(
  by: User,
  email: string,
  role: Role,
  orgId: string | null
): Promise<{ token: string } | { error: string }> {
  if (!canInvite(by, role, orgId)) {
    return { error: 'You cannot invite someone with that role.' }
  }

  const address = normaliseEmail(email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return { error: 'That does not look like an email address.' }
  }

  const sql = db()
  const existing = await sql`select id from users where email = ${address}`
  if (existing.length) return { error: 'That address already has an account.' }

  const token = newToken()
  await sql`
    insert into invites (token_hash, email, role, org_id, created_by, expires_at)
    values (
      ${hashOf(token)}, ${address}, ${role}, ${orgId}, ${by.id},
      ${new Date(Date.now() + INVITE_DAYS * 86400_000)}
    )
  `
  return { token }
}

interface PendingRow {
  email: string
  role: Role
  org_id: string | null
  org_name: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
}

/** Outstanding invitations the user is allowed to see. */
export async function pendingInvites(user: User): Promise<Invite[]> {
  const sql = db()
  const staff = user.role === 'staff'
  const orgId = user.orgId ?? '00000000-0000-0000-0000-000000000000'

  const rows = await sql<PendingRow[]>`
    select i.email, i.role, i.org_id, o.name as org_name,
           i.created_at, i.expires_at, i.accepted_at
    from invites i
    left join orgs o on o.id = i.org_id
    where i.accepted_at is null
      and i.expires_at > now()
      and ${staff ? sql`true` : sql`i.org_id = ${orgId}`}
    order by i.created_at desc
  `
  return rows.map((r) => ({
    email: r.email,
    role: r.role,
    orgId: r.org_id,
    orgName: r.org_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
  }))
}

export interface InviteOffer {
  email: string
  role: Role
  orgName: string | null
}

/** Reads an invite for its acceptance page. Never reveals why one is invalid. */
export async function readInvite(token: string): Promise<InviteOffer | null> {
  const rows = await db()<
    { email: string; role: Role; org_name: string | null }[]
  >`
    select i.email, i.role, o.name as org_name
    from invites i
    left join orgs o on o.id = i.org_id
    where i.token_hash = ${hashOf(token)}
      and i.accepted_at is null
      and i.expires_at > now()
    limit 1
  `
  if (!rows.length) return null
  return { email: rows[0].email, role: rows[0].role, orgName: rows[0].org_name }
}

/**
 * Turns an invite into an account.
 *
 * One transaction, and the invite is marked used inside it: two people
 * following the same link at once must not both get an account, and a failure
 * partway must not consume an invite without creating anything.
 */
export async function acceptInvite(
  token: string,
  password: string,
  name: string | null
): Promise<{ userId: string } | { error: string }> {
  if (password.length < 12) {
    return { error: 'Use at least 12 characters.' }
  }

  const sql = db()
  const { hash, salt } = await hashPassword(password)

  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<
        { email: string; role: Role; org_id: string | null }[]
      >`
        update invites set accepted_at = now()
        where token_hash = ${hashOf(token)}
          and accepted_at is null
          and expires_at > now()
        returning email, role, org_id
      `
      if (!rows.length) {
        return { error: 'That invitation is no longer valid.' }
      }
      const invite = rows[0]

      const created = await tx<{ id: string }[]>`
        insert into users (email, name, role, org_id, password_hash, password_salt)
        values (
          ${invite.email}, ${name}, ${invite.role}, ${invite.org_id},
          ${hash}, ${salt}
        )
        returning id
      `
      return { userId: created[0].id }
    })
  } catch {
    // The unique index on email is the last word: an address that acquired an
    // account between the check and here loses the race rather than colliding.
    return { error: 'That invitation could not be accepted.' }
  }
}
