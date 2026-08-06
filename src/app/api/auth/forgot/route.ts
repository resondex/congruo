import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { normaliseEmail } from '@/lib/auth'
import { requestReset } from '@/lib/resets'
import { hit, callerIp } from '@/lib/rate_limit'

/**
 * "I forgot my password."
 *
 * Always answers the same thing. Saying "no such account" here would turn the
 * endpoint into a way to test whether an address is registered, and this one
 * also sends mail - so a difference in the reply is both a disclosure and a
 * way to find addresses worth spamming.
 *
 * Limited hard for the same reason: every allowed request costs an email.
 */
const SAME_EVERY_TIME =
  'If that address has an account, a reset link is on its way.'

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ message: SAME_EVERY_TIME })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }
  const { email } = (body ?? {}) as Record<string, unknown>
  if (typeof email !== 'string') {
    return Response.json({ message: SAME_EVERY_TIME })
  }

  const address = normaliseEmail(email)
  const ip = callerIp(request.headers)
  const [byAccount, byAddress] = await Promise.all([
    hit(`forgot:acct:${address}`, 3, 3600),
    hit(`forgot:ip:${ip}`, 10, 3600),
  ])
  // Still the same message. A different reply when limited would say that the
  // limit had been reached for this address, which is the disclosure again.
  if (!byAccount.ok || !byAddress.ok) {
    return Response.json({ message: SAME_EVERY_TIME })
  }

  const origin = request.headers.get('origin') ?? new URL(request.url).origin
  await requestReset(address, (token) => `${origin}/reset/${token}`)

  return Response.json({ message: SAME_EVERY_TIME })
}
