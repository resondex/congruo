import 'server-only'
import { db } from './db'
import type { SourceKind } from './records'
import type { AnswerValue, QuestionType } from './survey'
import { getQuestions } from './survey_store'
import type { Explanation, ObservedRecord, ReconcileInput } from './reconcile'

/**
 * Loading the two halves of a reconciliation and storing what the respondent
 * said about it.
 */

interface AnswerRow {
  question_code: string
  value_text: string | null
  value_number: number | null
  value_codes: number[] | null
  value_json: { order?: number[]; parts?: Record<number, number> } | null
}

/**
 * Rebuilds the answer in the shape the question asked for.
 *
 * The type has to come from the question, not from the stored value. Both
 * `single` and `multiple` land in `value_codes`, so a multi-select with exactly
 * one option ticked is indistinguishable from a radio button by inspection -
 * and reading it as a radio once dropped it from reconciliation silently, which
 * is how that bug was found.
 */
function toAnswer(row: AnswerRow, type: QuestionType): AnswerValue | undefined {
  switch (type) {
    case 'scale':
    case 'number':
      return row.value_number === null
        ? undefined
        : { kind: 'number', value: row.value_number }
    case 'single':
    case 'multiple':
      return row.value_codes === null
        ? undefined
        : {
            kind: 'codes',
            codes: row.value_codes,
            text: row.value_text ?? undefined,
          }
    case 'text':
      return row.value_text === null
        ? undefined
        : { kind: 'text', value: row.value_text }
    case 'date':
      return row.value_text === null
        ? undefined
        : { kind: 'date', value: row.value_text }
    case 'ranking':
      return row.value_json?.order
        ? { kind: 'order', codes: row.value_json.order }
        : undefined
    case 'allocation':
      return row.value_json?.parts
        ? { kind: 'allocation', parts: row.value_json.parts }
        : undefined
    // Elements collect nothing, so there is nothing to rebuild.
    case 'section':
    case 'description':
    case 'media':
    case 'terminal':
      return undefined
  }
}

/**
 * Returns null when there is nothing to reconcile - no session, or a session
 * that never released. A respondent who declined has no record side, and
 * putting an empty comparison to them would be a strange way to thank someone
 * for taking part.
 */
export async function loadReconcileInput(
  studySlug: string,
  sessionId: string
): Promise<ReconcileInput | null> {
  const sql = db()

  const sessions = await sql<
    { id: string; released_at: string | null }[]
  >`
    select id, released_at from sessions
    where id = ${sessionId} and study_slug = ${studySlug}
    limit 1
  `
  if (!sessions.length || !sessions[0].released_at) return null

  const [questions, answerRows, recordRows, receipts, grants] =
    await Promise.all([
      getQuestions(studySlug),
      sql<AnswerRow[]>`
        select question_code, value_text, value_number, value_codes, value_json
        from survey_answers
        -- Matrix rows are one comparison each and no claim reads them yet;
        -- taking only the whole-question answers keeps this honest until one
        -- does, rather than silently comparing the first row.
        where session_id = ${sessionId} and row_code = 0
      `,
      sql<{ source: SourceKind; occurred_at: string; text: string }[]>`
        select source, occurred_at, text
        from released_records where session_id = ${sessionId}
      `,
      sql<{ withheld_count: number }[]>`
        select withheld_count from release_receipts
        where session_id = ${sessionId}
        order by created_at desc limit 1
      `,
      sql<{ source: SourceKind }[]>`
        select distinct source from consent_grants
        where session_id = ${sessionId} and granted = true
      `,
    ])

  const types = new Map(questions.map((q) => [q.code, q.type]))
  const answers: Record<string, AnswerValue | undefined> = {}
  for (const row of answerRows) {
    const type = types.get(row.question_code)
    // A question removed from the instrument after this respondent answered
    // it. The answer is kept in the table; it just has nothing to compare to.
    if (type) answers[row.question_code] = toAnswer(row, type)
  }

  const records: ObservedRecord[] = recordRows.map((r) => ({
    source: r.source,
    occurredAt: new Date(r.occurred_at).toISOString(),
    text: r.text,
  }))

  return {
    questions,
    answers,
    records,
    withheldCount: receipts[0]?.withheld_count ?? 0,
    // Falls back to what was actually released. A session whose consent rows
    // are missing should still reconcile on the evidence rather than silently
    // comparing nothing.
    grantedSources: grants.length
      ? grants.map((g) => g.source)
      : [...new Set(records.map((r) => r.source))],
    releasedAt: new Date(sessions[0].released_at),
  }
}

export interface ReconcileResponse {
  questionCode: string
  claimed: string
  observed: string
  agreed: boolean
  caveats: string[]
  explanation?: Explanation
  note?: string
}

export async function persistReconcile(
  sessionId: string,
  responses: ReconcileResponse[]
): Promise<{ recorded: number }> {
  const sql = db()

  await sql.begin(async (tx) => {
    if (responses.length) {
      const rows = responses.map((r) => ({
        session_id: sessionId,
        question_code: r.questionCode,
        claimed: r.claimed,
        observed: r.observed,
        agreed: r.agreed,
        caveats: r.caveats,
        explanation: r.explanation ?? null,
        note: r.note ?? null,
      }))
      await tx`
        insert into reconcile_responses ${tx(rows)}
        on conflict (session_id, question_code) do update set
          claimed     = excluded.claimed,
          observed    = excluded.observed,
          agreed      = excluded.agreed,
          caveats     = excluded.caveats,
          explanation = excluded.explanation,
          note        = excluded.note,
          created_at  = now()
      `
    }

    await tx`update sessions set reconciled_at = now() where id = ${sessionId}`
  })

  return { recorded: responses.length }
}
