import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { createStudy, updateStudy, type StudyInput } from '@/lib/studies_admin'
import { SOURCE_GROUPS, type SourceKind } from '@/lib/records'

const KNOWN_SOURCES = new Set<string>(
  SOURCE_GROUPS.flatMap((g) => g.sources)
)

/**
 * Reads a study body. Everything is validated here rather than trusted from a
 * form: the admin surface is signed in, but signed in is not the same as
 * correct, and a bad return host is an open redirect on a live fielding.
 */
function readBody(body: unknown): Omit<StudyInput, 'slug'> | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Expected an object.' }
  }
  const {
    name,
    mode,
    orgId,
    sources,
    returnHosts,
    defaultReturnUrl,
    windowFrom,
    windowTo,
    exportRawText,
  } = body as Record<string, unknown>

  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'The study needs a name.' }
  }
  if (mode !== 'full_service' && mode !== 'append') {
    return { error: 'Unknown mode.' }
  }
  if (orgId !== null && orgId !== undefined && typeof orgId !== 'string') {
    return { error: 'Bad organisation.' }
  }
  if (!Array.isArray(sources) || !sources.length) {
    return { error: 'Choose at least one source to ask for.' }
  }
  for (const s of sources) {
    if (typeof s !== 'string' || !KNOWN_SOURCES.has(s)) {
      return { error: `Unknown source: ${String(s)}` }
    }
  }

  const hosts: string[] = []
  if (returnHosts !== undefined && returnHosts !== null) {
    if (!Array.isArray(returnHosts)) return { error: 'Bad return hosts.' }
    for (const host of returnHosts) {
      if (typeof host !== 'string') return { error: 'Bad return host.' }
      const trimmed = host.trim().toLowerCase()
      if (!trimmed) continue
      // A hostname, not a URL. Anything with a scheme or path here would make
      // the allowlist look stricter than it is.
      if (!/^[a-z0-9.-]+$/.test(trimmed)) {
        return { error: `"${host}" is not a hostname. Use example.com.` }
      }
      hosts.push(trimmed)
    }
  }
  if (mode === 'append' && !hosts.length) {
    return {
      error:
        'An append study needs at least one return host, or there is nowhere safe to send respondents back to.',
    }
  }

  for (const value of [windowFrom, windowTo]) {
    if (value !== null && value !== undefined) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return { error: 'The window dates are not valid.' }
      }
    }
  }

  return {
    name: name.trim(),
    mode,
    orgId: (orgId as string | null) ?? null,
    sources: sources as SourceKind[],
    returnHosts: hosts,
    defaultReturnUrl:
      typeof defaultReturnUrl === 'string' && defaultReturnUrl.trim()
        ? defaultReturnUrl.trim()
        : null,
    windowFrom: (windowFrom as string) ?? null,
    windowTo: (windowTo as string) ?? null,
    exportRawText: exportRawText !== false,
  }
}

async function guard(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return { response: Response.json({ error: 'Expected JSON.' }, { status: 415 }) }
  }
  if (!dbConfigured()) {
    return { response: Response.json({ error: 'Not configured.' }, { status: 503 }) }
  }
  const user = await currentUser()
  if (!user) {
    return { response: Response.json({ error: 'Not signed in.' }, { status: 401 }) }
  }
  return { user }
}

export async function POST(request: NextRequest) {
  const checked = await guard(request)
  if ('response' in checked) return checked.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const parsed = readBody(body)
  if ('error' in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const { slug } = (body ?? {}) as Record<string, unknown>
  if (typeof slug !== 'string') {
    return Response.json({ error: 'The study needs a link name.' }, { status: 400 })
  }

  const result = await createStudy(checked.user, { ...parsed, slug })
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json(result)
}

export async function PATCH(request: NextRequest) {
  const checked = await guard(request)
  if ('response' in checked) return checked.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const parsed = readBody(body)
  if ('error' in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }
  const { slug } = (body ?? {}) as Record<string, unknown>
  if (typeof slug !== 'string') {
    return Response.json({ error: 'Which study?' }, { status: 400 })
  }

  const result = await updateStudy(checked.user, slug, parsed)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json({ ok: true })
}
