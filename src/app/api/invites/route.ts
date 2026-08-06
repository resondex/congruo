import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser, type Role } from '@/lib/auth'
import { createInvite } from '@/lib/invites'

const ROLES: Role[] = ['staff', 'client_admin', 'client_viewer']

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Accounts are not configured.' }, { status: 503 })
  }

  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const { email, role, orgId } = (body ?? {}) as Record<string, unknown>
  if (typeof email !== 'string') {
    return Response.json({ error: 'An email address is required.' }, { status: 400 })
  }
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
    return Response.json({ error: 'Unknown role.' }, { status: 400 })
  }
  if (orgId !== null && orgId !== undefined && typeof orgId !== 'string') {
    return Response.json({ error: 'Bad organisation.' }, { status: 400 })
  }

  // A client admin may only invite into their own org, whatever they send.
  // Taking the org from the request would let them name someone else's.
  const target =
    user.role === 'staff' ? ((orgId as string | null) ?? null) : user.orgId

  const result = await createInvite(user, email, role as Role, target)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  const origin = request.headers.get('origin') ?? new URL(request.url).origin
  return Response.json({
    // Returned once and never again: only the hash is stored.
    url: `${origin}/invite/${result.token}`,
  })
}
