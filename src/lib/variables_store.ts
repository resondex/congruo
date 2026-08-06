import 'server-only'
import { db, dbConfigured } from './db'
import type { DerivedRule, StudyVariable, VariableValue } from './variables'
import type { QualityResult } from './quality'

/**
 * Loading a study's variable definitions and storing what a session produced.
 */

interface Row {
  name: string
  label: string | null
  kind: 'hidden' | 'derived'
  source_param: string | null
  rule: DerivedRule | null
  position: number
}

export async function variablesFor(studySlug: string): Promise<StudyVariable[]> {
  if (!dbConfigured()) return []
  const rows = await db()<Row[]>`
    select name, label, kind, source_param, rule, position
    from study_variables where study_slug = ${studySlug}
    order by position, name
  `
  return rows.map((r) => ({
    name: r.name,
    label: r.label ?? undefined,
    kind: r.kind,
    sourceParam: r.source_param ?? undefined,
    rule: r.rule ?? undefined,
    position: r.position,
  }))
}

/**
 * Writes variable values, replacing any earlier ones for the same names.
 *
 * A derived variable is recomputed whenever the answers change, so overwriting
 * is the correct behaviour: the second computation is the right one, and
 * keeping both would leave two answers to the same question about the same
 * person.
 */
export async function persistVariables(
  sessionId: string,
  values: VariableValue[]
): Promise<void> {
  if (!values.length) return
  const sql = db()
  await sql`
    insert into session_variables ${sql(
      values.map((v) => ({
        session_id: sessionId,
        name: v.name,
        value_text: v.text ?? null,
        value_number: v.number ?? null,
      }))
    )}
    on conflict (session_id, name) do update set
      value_text   = excluded.value_text,
      value_number = excluded.value_number,
      recorded_at  = now()
  `
}

/**
 * Records every check that ran, passed or failed.
 *
 * Keeping the passes is what makes the failure rate a rate. A table of only
 * failures can say how many people failed but not out of how many, which is
 * the number that decides whether a sample is unusual.
 */
export async function persistQuality(
  sessionId: string,
  results: QualityResult[]
): Promise<void> {
  if (!results.length) return
  const sql = db()
  await sql`
    insert into quality_flags ${sql(
      results.map((r) => ({
        session_id: sessionId,
        question_code: r.questionCode,
        kind: r.kind,
        passed: r.passed,
        detail: r.detail ?? null,
      }))
    )}
    on conflict (session_id, question_code) do update set
      passed      = excluded.passed,
      detail      = excluded.detail,
      recorded_at = now()
  `
}
