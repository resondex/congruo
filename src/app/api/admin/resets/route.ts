import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { createReset } from '@/lib/resets'

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }
  const { userId } = (body ?? {}) as Record<string, unknown>
  if (typeof userId !== 'string') {
    return Response.json({ error: 'Which account?' }, { status: 400 })
  }

  const result = await createReset(user, userId)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  const origin = request.headers.get('origin') ?? new URL(request.url).origin
  return Response.json({
    email: result.email,
    // Shown once. Only the hash is stored.
    url: `${origin}/reset/${result.token}`,
  })
}
