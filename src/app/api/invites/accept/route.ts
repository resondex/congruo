import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { createSession } from '@/lib/auth'
import { acceptInvite } from '@/lib/invites'

/**
 * Turns an invitation into an account and signs the person straight in.
 *
 * Deliberately unauthenticated: the invite token is the credential, which is
 * why it is single-use, expiring, and stored only as a hash.
 */
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

  const { token, password, name } = (body ?? {}) as Record<string, unknown>
  if (typeof token !== 'string' || typeof password !== 'string') {
    return Response.json({ error: 'That invitation could not be accepted.' }, { status: 400 })
  }
  if (name !== undefined && name !== null && typeof name !== 'string') {
    return Response.json({ error: 'Bad name.' }, { status: 400 })
  }

  const result = await acceptInvite(token, password, (name as string) || null)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  await createSession(result.userId, request.headers.get('user-agent') ?? undefined)
  return Response.json({ ok: true })
}
