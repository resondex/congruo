import type { NextRequest } from 'next/server'
import { db, dbConfigured } from '@/lib/db'
import {
  createSession,
  normaliseEmail,
  verifyPassword,
  type Role,
} from '@/lib/auth'

/**
 * Sign-in for the people who run studies. Respondents never reach this.
 *
 * Every failure returns the same message and takes roughly the same time: the
 * password check runs even when no such account exists, so the endpoint does
 * not tell an attacker which addresses are registered.
 */

const SAME_FOR_EVERY_FAILURE = 'That email and password do not match.'

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

  const rows = await db()<Row[]>`
    select id, password_hash, password_salt, role, disabled_at
    from users where email = ${normaliseEmail(email)} limit 1
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

  await createSession(row.id, request.headers.get('user-agent') ?? undefined)
  return Response.json({ ok: true })
}
