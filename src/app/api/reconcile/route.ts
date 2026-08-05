import type { NextRequest } from 'next/server'
import { getStudy } from '@/lib/studies'
import { dbConfigured } from '@/lib/db'
import { loadReconcileInput, persistReconcile } from '@/lib/reconcile_store'
import {
  reconcile,
  EXPLANATIONS,
  MAX_NOTE,
  type Explanation,
} from '@/lib/reconcile'

/**
 * Computes the comparisons, and stores what the respondent said about them.
 *
 * Both halves are here because they are two ends of one exchange and share all
 * their validation. `action` picks between them.
 *
 * The comparison is computed server-side rather than sent up by the client:
 * it is derived from what we already hold, and a client-supplied divergence
 * would be a number we let the browser make up about our own data.
 */

const ALLOWED = new Set(EXPLANATIONS.map((e) => e.value as string))

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

  const { studySlug, sessionId, action, responses } = (body ?? {}) as Record<
    string,
    unknown
  >

  if (typeof studySlug !== 'string') {
    return Response.json({ error: 'studySlug is required.' }, { status: 400 })
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    return Response.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const study = await getStudy(studySlug)
  if (!study) {
    return Response.json({ error: 'Unknown study.' }, { status: 400 })
  }
  // We never see an append study's answers, so there is no self-report to put
  // a record beside. Offering the step would imply we hold something we do not.
  if (study.mode === 'append') {
    return Response.json(
      { error: 'This study has no reconcile step.' },
      { status: 400 }
    )
  }
  if (!dbConfigured()) {
    return Response.json({ comparisons: [], persisted: false }, { status: 200 })
  }

  let input
  try {
    input = await loadReconcileInput(studySlug, sessionId)
  } catch (error) {
    console.error('reconcile load failed', error)
    return Response.json({ error: 'Could not load your session.' }, { status: 500 })
  }
  if (!input) {
    // Nothing released, or a session that is not ours to read. Both are
    // ordinary and neither should look like a failure to the respondent.
    return Response.json({ comparisons: [], nothingToCompare: true })
  }

  const comparisons = reconcile(input)

  if (action !== 'respond') {
    return Response.json({ comparisons })
  }

  if (!Array.isArray(responses)) {
    return Response.json({ error: 'responses must be an array.' }, { status: 400 })
  }

  const known = new Map(comparisons.map((c) => [c.questionCode, c]))
  const parsed = []
  for (const raw of responses) {
    const { questionCode, explanation, note } = (raw ?? {}) as Record<
      string,
      unknown
    >
    if (typeof questionCode !== 'string') {
      return Response.json({ error: 'Bad questionCode.' }, { status: 400 })
    }
    // The comparison is looked up rather than accepted, so what gets stored
    // alongside an explanation is the divergence we computed and showed - not
    // whatever the client claims it displayed.
    const comparison = known.get(questionCode)
    if (!comparison) {
      return Response.json(
        { error: `Nothing to reconcile for ${questionCode}.` },
        { status: 400 }
      )
    }
    if (explanation !== undefined && explanation !== null) {
      if (typeof explanation !== 'string' || !ALLOWED.has(explanation)) {
        return Response.json({ error: 'Unknown explanation.' }, { status: 400 })
      }
    }
    if (note !== undefined && note !== null) {
      if (typeof note !== 'string' || note.length > MAX_NOTE) {
        return Response.json({ error: 'That note is too long.' }, { status: 400 })
      }
    }

    parsed.push({
      questionCode,
      claimed: comparison.claimed,
      observed: comparison.observed,
      agreed: comparison.agrees,
      caveats: comparison.caveats,
      explanation: (explanation as Explanation | undefined) ?? undefined,
      note: (note as string | undefined) || undefined,
    })
  }

  try {
    const { recorded } = await persistReconcile(sessionId, parsed)
    return Response.json({ recorded, comparisons })
  } catch (error) {
    console.error('reconcile save failed', error)
    return Response.json({ error: 'Could not save your answers.' }, { status: 500 })
  }
}
