import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { holdingFor, deleteSession } from '@/lib/deletion'
import { hit, callerIp } from '@/lib/rate_limit'

/**
 * Deletion, for the respondent.
 *
 * Deliberately unauthenticated: the token is the credential, and requiring an
 * account to be forgotten would defeat a design whose whole point is that
 * nobody needs one.
 *
 * POST previews what is held. DELETE destroys it. Two steps because the second
 * cannot be undone and cannot be checked afterwards - there is nowhere to log
 * back in and confirm.
 */

async function limited(request: NextRequest) {
  // Tokens are 256 bits of randomness, so guessing is not the threat; a
  // limiter here is against someone working through a stolen list.
  const check = await hit(`delete:ip:${callerIp(request.headers)}`, 20, 900)
  return check.ok ? null : Response.json({ error: 'Too many attempts.' }, { status: 429 })
}

async function readToken(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { error: Response.json({ error: 'Expected JSON.' }, { status: 415 }) }
  }
  try {
    const body = (await request.json()) as Record<string, unknown>
    const token = body?.token
    if (typeof token !== 'string' || !token) {
      return { error: Response.json({ error: 'That reference is not valid.' }, { status: 400 }) }
    }
    return { token }
  } catch {
    return { error: Response.json({ error: 'Malformed JSON.' }, { status: 400 }) }
  }
}

export async function POST(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const stop = await limited(request)
  if (stop) return stop

  const read = await readToken(request)
  if ('error' in read) return read.error

  const holding = await holdingFor(read.token)
  if (!holding || holding.alreadyDeleted) {
    return Response.json({ error: 'That reference is not valid.' }, { status: 404 })
  }
  return Response.json({ holding })
}

export async function DELETE(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const stop = await limited(request)
  if (stop) return stop

  const read = await readToken(request)
  if ('error' in read) return read.error

  const holding = await holdingFor(read.token)
  if (!holding || holding.alreadyDeleted) {
    return Response.json({ error: 'That reference is not valid.' }, { status: 404 })
  }

  await deleteSession(holding.sessionId)
  return Response.json({ ok: true })
}
