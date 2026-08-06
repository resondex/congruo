import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { createSession } from '@/lib/auth'
import { startAuthentication, finishAuthentication } from '@/lib/passkeys'
import { hit, callerIp } from '@/lib/rate_limit'

function origin(request: NextRequest) {
  return request.headers.get('origin') ?? new URL(request.url).origin
}

/**
 * Options for signing in with a passkey.
 *
 * Unauthenticated and names no account: the authenticator already knows which
 * key belongs to this site. Accepting an email here would make it a way to ask
 * which addresses have passkeys.
 */
export async function GET(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const limited = await hit(`passkey:ip:${callerIp(request.headers)}`, 60, 900)
  if (!limited.ok) {
    return Response.json({ error: 'Too many attempts.' }, { status: 429 })
  }
  return Response.json(await startAuthentication(origin(request)))
}

export async function POST(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const limited = await hit(`passkey:ip:${callerIp(request.headers)}`, 60, 900)
  if (!limited.ok) {
    return Response.json({ error: 'Too many attempts.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const result = await finishAuthentication(origin(request), body as never)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  await createSession(result.userId, request.headers.get('user-agent') ?? undefined)
  return Response.json({ ok: true })
}
