import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { startRegistration, finishRegistration, removePasskey } from '@/lib/passkeys'

function origin(request: NextRequest) {
  return request.headers.get('origin') ?? new URL(request.url).origin
}

/** Options for adding a passkey to the signed-in account. */
export async function GET(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  return Response.json(await startRegistration(user, origin(request)))
}

export async function POST(request: NextRequest) {
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
  const { response, label } = (body ?? {}) as Record<string, unknown>
  if (typeof response !== 'object' || response === null) {
    return Response.json({ error: 'That passkey could not be read.' }, { status: 400 })
  }

  const result = await finishRegistration(
    user,
    origin(request),
    response as never,
    typeof label === 'string' && label.trim() ? label.trim() : null
  )
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json({ ok: true })
}

/** Removing one is scoped to the owner, so an id alone is not enough. */
export async function DELETE(request: NextRequest) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Which passkey?' }, { status: 400 })

  await removePasskey(user.id, id)
  return Response.json({ ok: true })
}
