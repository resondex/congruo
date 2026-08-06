import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser, canEditStudies } from '@/lib/auth'
import { studyFor } from '@/lib/admin_store'
import { deleteSession } from '@/lib/deletion'

/**
 * Deleting a respondent's data from the admin.
 *
 * The token is the respondent's own route and is better, because it proves the
 * request came from them. This exists for the request that arrives by email,
 * which is how most of them will arrive - refusing those because the person
 * lost a reference would make the promise conditional on their filing.
 *
 * Admins only. A viewer can read a study and download it; ending someone's
 * participation is not a reading operation.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })
  if (!canEditStudies(user)) {
    return Response.json({ error: 'You cannot change this study.' }, { status: 403 })
  }

  const { slug } = await params
  if (!(await studyFor(user, slug))) {
    return Response.json({ error: 'No such study.' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }
  const { sessionId } = (body ?? {}) as Record<string, unknown>
  if (typeof sessionId !== 'string') {
    return Response.json({ error: 'Which session?' }, { status: 400 })
  }

  // Checked against the study the caller may see, so a session id alone cannot
  // reach into another org's fielding.
  const { db } = await import('@/lib/db')
  const found = await db()<{ id: string }[]>`
    select id from sessions where id = ${sessionId} and study_slug = ${slug} limit 1
  `
  if (!found.length) {
    return Response.json({ error: 'No such session in this study.' }, { status: 404 })
  }

  await deleteSession(sessionId)
  return Response.json({ ok: true })
}
