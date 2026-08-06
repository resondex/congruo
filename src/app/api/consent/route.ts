import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { findOrCreateSession, recordConsent } from '@/lib/sessions'
import { variablesFor, persistVariables } from '@/lib/variables_store'
import { readHidden } from '@/lib/variables'

/**
 * Records what the respondent agreed to, before anything is collected.
 *
 * Written at the first hop so a grant exists even for respondents who never
 * come back to release. Those sessions are the comparison group that makes
 * donation-selection bias measurable, so they matter as much as completions.
 */

const SOURCES = new Set([
  'google_search',
  'google_ai_mode',
  'google_image_search',
  'google_video_search',
  'google_hotels',
  'google_shopping',
  'google_maps',
  'youtube',
  'youtube_engagement',
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

  const { studySlug, respondentId, grants, disclosureVersion, comprehensionPassed, query } =
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
    // Hidden variables ride in on the link, so consent is the only moment they
    // are reliably available - a respondent who comes back tomorrow arrives at
    // a bare URL. Stored here, never shown, and never allowed to fail the
    // consent record itself.
    if (query && typeof query === 'object' && !Array.isArray(query)) {
      try {
        const defined = await variablesFor(studySlug)
        await persistVariables(
          session.id,
          readHidden(defined, query as Record<string, string>)
        )
      } catch (error) {
        console.error('hidden variables failed', error)
      }
    }

    return Response.json(
      { recorded: true, sessionId: session.id },
      { status: 200 }
    )
  } catch (error) {
    console.error('consent failed', error)
    return Response.json({ error: 'Could not record consent.' }, { status: 500 })
  }
}
