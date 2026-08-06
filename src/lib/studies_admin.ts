import 'server-only'
import { db } from './db'
import { canEditStudies, canSeeOrg, type User } from './auth'
import type { SourceKind } from './records'

/**
 * Writes for the admin surface.
 *
 * Every function takes the user doing it and refuses first. The reads in
 * admin_store scope by org; these do the same and additionally check the
 * tier, because a viewer who can read a study must not be able to change what
 * it collects.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

export interface StudyInput {
  slug: string
  name: string
  mode: 'full_service' | 'append'
  orgId: string | null
  sources: SourceKind[]
  returnHosts: string[]
  defaultReturnUrl: string | null
  windowFrom: string | null
  windowTo: string | null
  exportRawText: boolean
}

/**
 * A slug is in the link every respondent receives, so it is lowercase, stable,
 * and cannot be changed once records exist against it.
 */
export function slugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) {
    return 'Use 3 to 50 characters: lowercase letters, numbers and hyphens.'
  }
  // Reserved because /s/<slug> and these would collide.
  if (['new', 'admin', 'api', 'login', 'invite'].includes(slug)) {
    return 'That name is reserved.'
  }
  return null
}

async function assertMayWrite(user: User, orgId: string | null) {
  if (!canEditStudies(user)) throw new Error('You cannot change studies.')
  if (!canSeeOrg(user, orgId)) throw new Error('That organisation is not yours.')
}

export async function createStudy(
  user: User,
  input: StudyInput
): Promise<{ slug: string } | { error: string }> {
  const problem = slugProblem(input.slug)
  if (problem) return { error: problem }

  // A client's study is always their own org's, whatever was submitted.
  const orgId = user.role === 'staff' ? input.orgId : user.orgId
  if (user.role !== 'staff' && !orgId) {
    return { error: 'Your account is not attached to an organisation.' }
  }
  try {
    await assertMayWrite(user, orgId)
  } catch (error) {
    return { error: (error as Error).message }
  }

  const sql = db()
  const taken = await sql`select slug from studies where slug = ${input.slug}`
  if (taken.length) return { error: 'A study with that name already exists.' }

  await sql`
    insert into studies (
      slug, name, mode, sources, return_hosts, default_return_url,
      respondent_param, status_param, window_from, window_to,
      org_id, created_by, export_raw_text
    ) values (
      ${input.slug}, ${input.name}, ${input.mode}, ${input.sources},
      ${input.returnHosts}, ${input.defaultReturnUrl},
      'rid', 'status', ${input.windowFrom}, ${input.windowTo},
      ${orgId}, ${user.id}, ${input.exportRawText}
    )
  `
  return { slug: input.slug }
}

export async function updateStudy(
  user: User,
  slug: string,
  input: Omit<StudyInput, 'slug'>
): Promise<{ ok: true } | { error: string }> {
  const sql = db()
  const rows = await sql<{ org_id: string | null }[]>`
    select org_id from studies where slug = ${slug} limit 1
  `
  if (!rows.length) return { error: 'No such study.' }

  try {
    // Checked against the study's current org, not the submitted one: moving a
    // study you cannot see into an org you can would otherwise be a way to
    // take it.
    await assertMayWrite(user, rows[0].org_id)
    if (user.role === 'staff') await assertMayWrite(user, input.orgId)
  } catch (error) {
    return { error: (error as Error).message }
  }

  const orgId = user.role === 'staff' ? input.orgId : rows[0].org_id

  await sql`
    update studies set
      name = ${input.name},
      mode = ${input.mode},
      sources = ${input.sources},
      return_hosts = ${input.returnHosts},
      default_return_url = ${input.defaultReturnUrl},
      window_from = ${input.windowFrom},
      window_to = ${input.windowTo},
      org_id = ${orgId},
      export_raw_text = ${input.exportRawText}
    where slug = ${slug}
  `
  return { ok: true }
}

export interface QuestionInput {
  code: string
  position: number
  page: number
  type: 'single' | 'multiple' | 'scale' | 'number' | 'text'
  prompt: string
  help: string | null
  options: { code: number; label: string; mapsTo?: string; exclusive?: boolean }[]
  allowOther: boolean
  allowPreferNotToSay: boolean
  minSelections: number | null
  maxSelections: number | null
  matrixRows: { code: number; label: string }[] | null
  required: boolean
  min: number | null
  max: number | null
  minLabel: string | null
  maxLabel: string | null
  /**
   * Rule bodies, validated at the route before they reach here. Typed loosely
   * on purpose: `claim` and the two conditions are open shapes the reconcile
   * and branching modules own, and narrowing them here would mean editing this
   * file every time one of them grows a field.
   */
  claim: Record<string, unknown> | null
  showIf: Record<string, unknown> | null
  terminateIf: Record<string, unknown> | null
}

/**
 * Replaces a study's whole instrument in one transaction.
 *
 * All-at-once rather than per question because the parts refer to each other:
 * a branch names a question by code, and positions decide what "earlier" means.
 * Saving one row at a time would let a questionnaire sit in a state where a
 * rule points at something that does not exist yet.
 *
 * Answers already given are not touched. They are keyed on the question code,
 * so a code that survives an edit keeps its data and a renamed one orphans it -
 * which is why the editor warns before letting a code change on a study that
 * has already fielded.
 */
export async function replaceQuestions(
  user: User,
  slug: string,
  questions: QuestionInput[]
): Promise<{ ok: true } | { error: string }> {
  const sql = db()
  const rows = await sql<{ org_id: string | null }[]>`
    select org_id from studies where slug = ${slug} limit 1
  `
  if (!rows.length) return { error: 'No such study.' }
  try {
    await assertMayWrite(user, rows[0].org_id)
  } catch (error) {
    return { error: (error as Error).message }
  }

  const codes = new Set<string>()
  for (const q of questions) {
    if (!/^[a-z0-9_]{2,60}$/.test(q.code)) {
      return {
        error: `"${q.code}" is not a usable code. Use lowercase letters, numbers and underscores.`,
      }
    }
    if (codes.has(q.code)) return { error: `Two questions share the code ${q.code}.` }
    codes.add(q.code)
    if (!q.prompt.trim()) return { error: `${q.code} has no question text.` }
    if ((q.type === 'single' || q.type === 'multiple') && !q.options.length) {
      return { error: `${q.code} needs at least one option.` }
    }
  }

  await sql.begin(async (tx) => {
    await tx`delete from survey_questions where study_slug = ${slug}`
    if (!questions.length) return
    await tx`
      insert into survey_questions ${tx(
        questions.map((q) => ({
          study_slug: slug,
          code: q.code,
          position: q.position,
          page: q.page,
          type: q.type,
          prompt: q.prompt,
          help: q.help,
          options: tx.json(q.options),
          matrix_rows: q.matrixRows ? tx.json(q.matrixRows) : null,
          allow_other: q.allowOther,
          allow_prefer_not_to_say: q.allowPreferNotToSay,
          min_selections: q.minSelections,
          max_selections: q.maxSelections,
          required: q.required,
          min_value: q.min,
          max_value: q.max,
          min_label: q.minLabel,
          max_label: q.maxLabel,
          claim: q.claim ? tx.json(q.claim as never) : null,
          show_if: q.showIf ? tx.json(q.showIf as never) : null,
          terminate_if: q.terminateIf ? tx.json(q.terminateIf as never) : null,
        }))
      )}
    `
  })

  return { ok: true }
}
