import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { replaceQuestions, type QuestionInput } from '@/lib/studies_admin'
import { isCondition } from '@/lib/conditions'

const TYPES = [
  'single',
  'multiple',
  'scale',
  'number',
  'text',
  'date',
  'ranking',
  'allocation',
  'section',
  'description',
  'media',
  'terminal',
]

function readQuestion(raw: unknown, index: number): QuestionInput | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: `Question ${index + 1} is not an object.` }
  }
  const q = raw as Record<string, unknown>

  if (typeof q.code !== 'string') return { error: `Question ${index + 1} has no code.` }
  if (typeof q.type !== 'string' || !TYPES.includes(q.type)) {
    return { error: `Question ${q.code} has an unknown type.` }
  }
  if (typeof q.prompt !== 'string') {
    return { error: `Question ${q.code} has no text.` }
  }

  // Codes come from the client because they are assigned once and must not be
  // renumbered by a save; they are still checked for shape and uniqueness here,
  // since "the browser said so" is not a reason to trust an analysis key.
  const options: { code: number; label: string; mapsTo?: string; exclusive?: boolean }[] = []
  const seenCodes = new Set<number>()
  if (Array.isArray(q.options)) {
    for (const option of q.options) {
      const { code, label, mapsTo, exclusive } = (option ?? {}) as Record<string, unknown>
      if (typeof code !== 'number' || !Number.isInteger(code) || code < 1) {
        return { error: `Question ${q.code} has an option with no code.` }
      }
      if (code === 97 || code === 98) {
        return {
          error: `Question ${q.code} uses a reserved code - 97 and 98 are "other" and "prefer not to say".`,
        }
      }
      if (seenCodes.has(code)) {
        return { error: `Question ${q.code} uses code ${code} twice.` }
      }
      seenCodes.add(code)
      if (typeof label !== 'string') {
        return { error: `Question ${q.code} has an option with no label.` }
      }
      options.push({
        code,
        label: label.trim(),
        mapsTo: typeof mapsTo === 'string' && mapsTo.trim() ? mapsTo.trim() : undefined,
        exclusive: exclusive === true ? true : undefined,
      })
    }
  }

  // A malformed rule is refused rather than stored. Accepting it would give a
  // branch that never fires, which reads exactly like one nobody matched.
  for (const field of ['claim', 'showIf', 'terminateIf'] as const) {
    const value = q[field]
    if (value === null || value === undefined) continue
    if (typeof value !== 'object') {
      return { error: `Question ${q.code} has a malformed ${field}.` }
    }
    if (field !== 'claim' && !isCondition(value)) {
      return { error: `Question ${q.code} has a rule that is not valid.` }
    }
  }

  // Checked rather than trusted: a malformed check would run against every
  // respondent and silently pass or fail all of them.
  let quality: Record<string, unknown> | null = null
  if (q.qualityCheck && typeof q.qualityCheck === 'object') {
    const { kind, expect, of } = q.qualityCheck as Record<string, unknown>
    const kinds = ['attention', 'red_herring', 'duplicate', 'gibberish']
    if (typeof kind !== 'string' || !kinds.includes(kind)) {
      return { error: `Question ${q.code} has an unknown quality check.` }
    }
    if (kind === 'attention') {
      if (!Array.isArray(expect) || !expect.length || !expect.every((c) => typeof c === 'number')) {
        return { error: `Question ${q.code} is an attention check with no passing answer.` }
      }
    }
    if (kind === 'duplicate' && (typeof of !== 'string' || !of)) {
      return { error: `Question ${q.code} must say which question it duplicates.` }
    }
    quality = q.qualityCheck as Record<string, unknown>
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  return {
    code: q.code.trim(),
    position: typeof q.position === 'number' ? q.position : index + 1,
    page: typeof q.page === 'number' ? q.page : index,
    type: q.type as QuestionInput['type'],
    prompt: q.prompt,
    help: str(q.help),
    options,
    required: q.required !== false,
    min: num(q.min),
    max: num(q.max),
    minLabel: str(q.minLabel),
    maxLabel: str(q.maxLabel),
    allowOther: q.allowOther === true,
    allowPreferNotToSay: q.allowPreferNotToSay === true,
    minSelections: num(q.minSelections),
    maxSelections: num(q.maxSelections),
    matrixRows: null,
    mediaUrl: str(q.mediaUrl),
    mediaAlt: str(q.mediaAlt),
    qualityCheck: quality,
    claim: (q.claim as Record<string, unknown>) ?? null,
    showIf: (q.showIf as Record<string, unknown>) ?? null,
    terminateIf: (q.terminateIf as Record<string, unknown>) ?? null,
  }
}

export async function PUT(
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }

  const { questions } = (body ?? {}) as Record<string, unknown>
  if (!Array.isArray(questions)) {
    return Response.json({ error: 'questions must be an array.' }, { status: 400 })
  }

  const parsed: QuestionInput[] = []
  for (const [index, raw] of questions.entries()) {
    const question = readQuestion(raw, index)
    if ('error' in question) {
      return Response.json({ error: question.error }, { status: 400 })
    }
    parsed.push(question)
  }

  const { slug } = await params
  const result = await replaceQuestions(user, slug, parsed)
  if ('error' in result) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json({ ok: true, saved: parsed.length })
}
