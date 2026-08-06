import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { createSession } from '@/lib/auth'
import { consumeReset } from '@/lib/resets'

/** Unauthenticated on purpose: the token is the credential. */
export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }
  const { token, password } = (body ?? {}) as Record<string, unknown>
  if (typeof token !== 'string' || typeof password !== 'string') {
    return Response.json({ error: 'That reset link is no longer valid.' }, { status: 400 })
  }

  const result = await consumeReset(token, password)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  // Every other session was just ended; give this browser a fresh one.
  await createSession(result.userId, request.headers.get('user-agent') ?? undefined)
  return Response.json({ ok: true })
}
