import 'server-only'
import { db, dbConfigured } from './db'
import type { Answers, Claim, Question, QuestionType } from './survey'

/**
 * Loading and storing the instrument.
 *
 * Split from `survey.ts` because the question types and the validation rules
 * are shared with the form in the browser, and this half never can be.
 */

interface QuestionRow {
  code: string
  position: number
  page: number
  type: QuestionType
  prompt: string
  help: string | null
  options: { value: string; label: string }[]
  required: boolean
  min_value: number | null
  max_value: number | null
  min_label: string | null
  max_label: string | null
  claim: Claim | null
}

function fromRow(row: QuestionRow): Question {
  return {
    code: row.code,
    position: row.position,
    page: row.page,
    type: row.type,
    prompt: row.prompt,
    help: row.help ?? undefined,
    options: Array.isArray(row.options) ? row.options : [],
    required: row.required,
    min: row.min_value ?? undefined,
    max: row.max_value ?? undefined,
    minLabel: row.min_label ?? undefined,
    maxLabel: row.max_label ?? undefined,
    claim: row.claim ?? undefined,
  }
}

/**
 * A study with no questions is not an error. Append-mode studies never have
 * any, and a full-service study being set up may not have them yet - the flow
 * skips the survey step rather than blocking on it.
 */
export async function getQuestions(studySlug: string): Promise<Question[]> {
  if (!dbConfigured()) return []

  const rows = await db()<QuestionRow[]>`
    select code, position, page, type, prompt, help, options, required,
           min_value, max_value, min_label, max_label, claim
    from survey_questions
    where study_slug = ${studySlug}
    order by position
  `
  return rows.map(fromRow)
}

/**
 * Writes the answers and stamps the session as surveyed.
 *
 * One transaction, and the stamp is part of it: a session marked surveyed
 * whose answers failed to land would let the respondent through to the review
 * step having contributed no self-report, which is the one thing the ordering
 * in invariant 2 exists to prevent.
 */
export async function persistSurvey(
  sessionId: string,
  answers: Answers
): Promise<{ answered: number }> {
  const rows = Object.entries(answers)
    .filter(([, value]) => value !== undefined)
    .map(([code, value]) => {
      const answer = value!
      return {
        session_id: sessionId,
        question_code: code,
        value_text: answer.kind === 'text' ? answer.value : null,
        value_number: answer.kind === 'number' ? answer.value : null,
        value_choices:
          answer.kind === 'choices'
            ? answer.values
            : answer.kind === 'choice'
              ? [answer.value]
              : null,
      }
    })

  const sql = db()

  await sql.begin(async (tx) => {
    if (rows.length) {
      // Re-submission overwrites. A respondent who goes back and changes an
      // answer, or whose request is retried after a dropped connection, must
      // not leave two conflicting rows for one question.
      await tx`
        insert into survey_answers ${tx(rows)}
        on conflict (session_id, question_code) do update set
          value_text    = excluded.value_text,
          value_number  = excluded.value_number,
          value_choices = excluded.value_choices,
          answered_at   = now()
      `
    }

    await tx`
      update sessions set survey_done_at = now() where id = ${sessionId}
    `
  })

  return { answered: rows.length }
}
