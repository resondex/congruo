import type { NextRequest } from 'next/server'
import { db, dbConfigured } from '@/lib/db'
import {
  createSession,
  normaliseEmail,
  verifyPassword,
  type Role,
} from '@/lib/auth'
import { hit, clear, callerIp, sweep } from '@/lib/rate_limit'

/**
 * Sign-in for the people who run studies. Respondents never reach this.
 *
 * Every failure returns the same message and takes roughly the same time: the
 * password check runs even when no such account exists, so the endpoint does
 * not tell an attacker which addresses are registered.
 */

const SAME_FOR_EVERY_FAILURE = 'That email and password do not match.'

/**
 * Two counters, because they stop different things.
 *
 * By account: someone working through a password list against one address.
 * By address: someone working through a list of accounts from one machine,
 * which the per-account counter would never see. The second is looser because
 * an office shares an address and a genuine group of colleagues should not
 * lock each other out.
 *
 * scrypt already makes each attempt cost real CPU, which is protection and
 * also the problem - unthrottled, an attacker can exhaust the server's CPU
 * without ever guessing anything.
 */
const PER_ACCOUNT = { limit: 8, seconds: 900 }
const PER_ADDRESS = { limit: 40, seconds: 900 }

interface Row {
  id: string
  password_hash: string | null
  password_salt: string | null
  role: Role
  disabled_at: string | null
}

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Accounts are not configured.' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string' || !password) {
    return Response.json({ error: SAME_FOR_EVERY_FAILURE }, { status: 400 })
  }

  void sweep()
  const address = normaliseEmail(email)
  const ip = callerIp(request.headers)

  // Counted before the password is checked, so a wrong guess costs an attempt
  // whether or not the account exists.
  const [byAccount, byAddress] = await Promise.all([
    hit(`login:acct:${address}`, PER_ACCOUNT.limit, PER_ACCOUNT.seconds),
    hit(`login:ip:${ip}`, PER_ADDRESS.limit, PER_ADDRESS.seconds),
  ])
  const limited = !byAccount.ok ? byAccount : !byAddress.ok ? byAddress : null
  if (limited) {
    return Response.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limited.retryAfter / 60)} minutes.`,
      },
      { status: 429, headers: { 'retry-after': String(limited.retryAfter) } }
    )
  }

  const rows = await db()<Row[]>`
    select id, password_hash, password_salt, role, disabled_at
    from users where email = ${address} limit 1
  `
  const row = rows[0]

  // Runs the derivation even with no row, so a registered address is not
  // distinguishable from an unregistered one by how long the answer takes.
  const ok = await verifyPassword(
    password,
    row?.password_hash ?? null,
    row?.password_salt ?? null
  )

  if (!row || !ok || row.disabled_at) {
    return Response.json({ error: SAME_FOR_EVERY_FAILURE }, { status: 401 })
  }

  // Only a success clears it: someone who mistyped four times and then got it
  // right should not still be one attempt from a lockout.
  await clear(`login:acct:${address}`)
  await createSession(row.id, request.headers.get('user-agent') ?? undefined)
  return Response.json({ ok: true })
}
