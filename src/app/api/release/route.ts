import type { NextRequest } from 'next/server'

/**
 * Accepts records the respondent has released. Nothing else.
 *
 * ---------------------------------------------------------------------------
 * DO NOT MAKE THIS ENDPOINT ACCEPT A FILE.
 *
 * The consent claim this product rests on is that we only ever received what
 * the respondent reviewed and released. That stops being true the moment an
 * archive is uploaded and parsed here, however convenient that would be.
 * Parsing lives in src/lib/parsers and runs in the browser. See
 * docs/architecture.md.
 * ---------------------------------------------------------------------------
 */

const MAX_RECORDS = 50_000
const MAX_TEXT = 20_000

interface ReleasePayload {
  sessionId: string
  studySlug: string
  /**
   * The referring platform's own id in append mode. It is the only join key
   * between our records and the client's survey file, and we never ask for
   * anything identifying beyond it.
   */
  respondentId?: string
  records: {
    source: string
    timestamp: string
    text: string
    context?: string
  }[]
  withheldCount: number
}

const SOURCES = new Set([
  'google_search',
  'gemini',
  'chatgpt',
  'claude',
  'perplexity',
])

function validate(body: unknown): ReleasePayload | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Expected an object.' }
  }
  const { sessionId, studySlug, respondentId, records, withheldCount } =
    body as Record<string, unknown>

  if (typeof sessionId !== 'string' || !sessionId) {
    return { error: 'sessionId is required.' }
  }
  if (typeof studySlug !== 'string' || !studySlug) {
    return { error: 'studySlug is required.' }
  }
  if (respondentId !== undefined && typeof respondentId !== 'string') {
    return { error: 'respondentId must be a string when present.' }
  }
  if (!Array.isArray(records)) {
    return { error: 'records must be an array.' }
  }
  if (records.length > MAX_RECORDS) {
    return { error: `Too many records; the maximum is ${MAX_RECORDS}.` }
  }

  for (const record of records) {
    if (typeof record !== 'object' || record === null) {
      return { error: 'Each record must be an object.' }
    }
    const { source, timestamp, text, context } = record as Record<
      string,
      unknown
    >
    if (typeof source !== 'string' || !SOURCES.has(source)) {
      return { error: `Unknown source: ${String(source)}` }
    }
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      return { error: 'Each record needs a valid ISO timestamp.' }
    }
    if (typeof text !== 'string' || !text || text.length > MAX_TEXT) {
      return { error: 'Each record needs text within the length limit.' }
    }
    if (context !== undefined && typeof context !== 'string') {
      return { error: 'context must be a string when present.' }
    }
  }

  return {
    sessionId,
    studySlug,
    respondentId: respondentId as string | undefined,
    records: records as ReleasePayload['records'],
    withheldCount:
      typeof withheldCount === 'number' && withheldCount >= 0
        ? withheldCount
        : 0,
  }
}

export async function POST(request: NextRequest) {
  // Guard the invariant at the door: a file upload is never a valid release.
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return Response.json(
      {
        error:
          'This endpoint accepts released records as JSON only. Archives are parsed in the browser and are never uploaded.',
      },
      { status: 415 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const result = validate(body)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  // TODO: persist via Supabase service-role client once the schema is applied.
  // Deliberately not wired up yet - see README status.
  const receipt = {
    sessionId: result.sessionId,
    studySlug: result.studySlug,
    respondentId: result.respondentId ?? null,
    releasedCount: result.records.length,
    withheldCount: result.withheldCount,
    sources: [...new Set(result.records.map((r) => r.source))],
    earliest: result.records.reduce<string | null>(
      (min, r) => (min === null || r.timestamp < min ? r.timestamp : min),
      null
    ),
    latest: result.records.reduce<string | null>(
      (max, r) => (max === null || r.timestamp > max ? r.timestamp : max),
      null
    ),
    receivedAt: new Date().toISOString(),
  }

  return Response.json({ receipt }, { status: 200 })
}
