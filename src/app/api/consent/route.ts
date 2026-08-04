import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { findOrCreateSession, recordConsent } from '@/lib/sessions'

/**
 * Records what the respondent agreed to, before anything is collected.
 *
 * Written at the first hop so a grant exists even for respondents who never
 * come back to release. Those sessions are the comparison group that makes
 * donation-selection bias measurable, so they matter as much as completions.
 */

const SOURCES = new Set([
  'google_search',
  'gemini',
  'chatgpt',
  'claude',
  'perplexity',
])

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const { studySlug, respondentId, grants, disclosureVersion, comprehensionPassed } =
    (body ?? {}) as Record<string, unknown>

  if (typeof studySlug !== 'string' || !(await getStudy(studySlug))) {
    return Response.json({ error: 'Unknown study.' }, { status: 400 })
  }
  if (respondentId !== undefined && typeof respondentId !== 'string') {
    return Response.json({ error: 'Bad respondentId.' }, { status: 400 })
  }
  if (typeof disclosureVersion !== 'string' || !disclosureVersion) {
    return Response.json({ error: 'disclosureVersion is required.' }, { status: 400 })
  }
  if (!Array.isArray(grants)) {
    return Response.json({ error: 'grants must be an array.' }, { status: 400 })
  }

  const parsed: { source: string; granted: boolean }[] = []
  for (const grant of grants) {
    const { source, granted } = (grant ?? {}) as Record<string, unknown>
    if (typeof source !== 'string' || !SOURCES.has(source)) {
      return Response.json({ error: `Unknown source: ${String(source)}` }, { status: 400 })
    }
    if (typeof granted !== 'boolean') {
      return Response.json({ error: 'granted must be a boolean.' }, { status: 400 })
    }
    parsed.push({ source, granted })
  }

  if (!dbConfigured()) {
    return Response.json({ recorded: false }, { status: 200 })
  }

  try {
    const session = await findOrCreateSession(
      studySlug,
      respondentId as string | undefined
    )
    await recordConsent(
      session.id,
      parsed as Parameters<typeof recordConsent>[1],
      disclosureVersion,
      comprehensionPassed === true
    )
    return Response.json(
      { recorded: true, sessionId: session.id },
      { status: 200 }
    )
  } catch (error) {
    console.error('consent failed', error)
    return Response.json({ error: 'Could not record consent.' }, { status: 500 })
  }
}
