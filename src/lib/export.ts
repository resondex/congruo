import 'server-only'
import { db } from './db'
import { OTHER_CODE, PREFER_NOT_CODE, type Question } from './survey'
import { getQuestions } from './survey_store'
import { variablesFor } from './variables_store'

/**
 * The delivered file.
 *
 * One row per respondent, wide, because that is the shape every analysis tool
 * and every analyst expects. A long file is easier to write and harder to use,
 * and this is the artefact a client actually receives - the place to spend
 * effort is here rather than on the query that produces it.
 *
 * Multi-select becomes one binary column per option rather than a
 * comma-joined string. Splitting it in a spreadsheet afterwards is the kind of
 * step where a study quietly loses cases, and the binary form is what a
 * crosstab wants anyway.
 */

export interface Column {
  name: string
  label: string
  /** What a value in this column means, for the codebook. */
  values?: string
}

export type Cell = string | number | Date | null

export interface Table {
  columns: Column[]
  rows: Cell[][]
}

/** RFC 4180: quote anything with a comma, quote, or newline; double the quotes. */
function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  // Timestamps arrive from Postgres as Date objects, and String(Date) gives
  // "Thu Aug 06 2026 08:40:47 GMT-0700 (Pacific Daylight Time)" - the reader's
  // locale and zone baked into a research file, which no tool will parse and
  // which means something different depending on who opened it.
  const text = value instanceof Date ? value.toISOString() : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(table: Table): string {
  // A row that does not match the header is a file where every column after
  // the gap means something else. Better to fail here than to deliver it.
  const wrong = table.rows.findIndex((r) => r.length !== table.columns.length)
  if (wrong !== -1) {
    throw new Error(
      `Row ${wrong} has ${table.rows[wrong].length} cells for ${table.columns.length} columns.`
    )
  }
  const head = table.columns.map((c) => csvCell(c.name)).join(',')
  const body = table.rows.map((r) => r.map(csvCell).join(','))
  return [head, ...body].join('\n')
}

/**
 * The columns one question produces.
 *
 * A question is not a column. A multi-select is one per option, a matrix is one
 * per row times whatever the inner question needs, and a ranking is one per
 * thing ranked. Working that out in one place is what keeps the data file and
 * the codebook describing the same thing.
 */
function columnsFor(question: Question, rawText: boolean): Column[] {
  const rows = question.matrixRows?.length
    ? question.matrixRows
    : [{ code: 0, label: '' }]
  const out: Column[] = []

  for (const row of rows) {
    const base = row.code ? `${question.code}_r${row.code}` : question.code
    const prefix = row.label ? `${question.prompt} - ${row.label}` : question.prompt

    switch (question.type) {
      case 'multiple':
        for (const option of question.options) {
          out.push({
            name: `${base}_${option.code}`,
            label: `${prefix} - ${option.label}`,
            values: '1 chosen, 0 not',
          })
        }
        if (question.allowOther) {
          out.push({ name: `${base}_${OTHER_CODE}`, label: `${prefix} - Other`, values: '1 chosen, 0 not' })
        }
        if (question.allowPreferNotToSay) {
          out.push({ name: `${base}_${PREFER_NOT_CODE}`, label: `${prefix} - Prefer not to say`, values: '1 chosen, 0 not' })
        }
        break

      case 'ranking':
        for (const option of question.options) {
          out.push({
            name: `${base}_${option.code}`,
            label: `${prefix} - rank of ${option.label}`,
            values: '1 is first; empty means not ranked',
          })
        }
        break

      case 'allocation':
        for (const option of question.options) {
          out.push({
            name: `${base}_${option.code}`,
            label: `${prefix} - points to ${option.label}`,
          })
        }
        break

      default:
        out.push({
          name: base,
          label: prefix,
          values:
            question.type === 'single' || question.type === 'polar'
              ? question.options.map((o) => `${o.code}=${o.label}`).join('; ')
              : question.type === 'overlap'
                ? '-100 apart to 100 fully overlapping'
                : question.pointLabels?.length
                  ? question.pointLabels.map((l, i) => `${i + 1}=${l}`).join('; ')
                  : undefined,
        })
    }

    // The verbatim beside an "other" selection is a column of its own. It is
    // always present so the header and the rows cannot drift apart; when raw
    // text is off the cell says so rather than the column disappearing.
    if (question.allowOther) {
      out.push({
        name: `${base}_other_text`,
        label: `${prefix} - other, in their words`,
        values: rawText ? undefined : 'Withheld by this study',
      })
    }
  }

  return out
}

interface AnswerRow {
  session_id: string
  question_code: string
  row_code: number
  value_text: string | null
  value_number: number | null
  value_codes: number[] | null
  value_json: { order?: number[]; parts?: Record<string, number> } | null
}

/**
 * One row per respondent.
 *
 * Includes everyone who started, not only those who finished. A file of
 * completes cannot answer "who dropped out and were they different", and that
 * question is most of what a fielding report is for.
 */
export async function responsesTable(
  slug: string,
  rawText: boolean
): Promise<Table> {
  const sql = db()
  const [questions, variables, sessions, answers, flags, vars] = await Promise.all([
    getQuestions(slug),
    variablesFor(slug),
    sql<
      {
        id: string
        external_respondent_id: string | null
        created_at: string
        survey_done_at: string | null
        released_at: string | null
        declined_at: string | null
        screened_out_at: string | null
        reconciled_at: string | null
        deleted_at: string | null
        records: number
      }[]
    >`
      select s.id, s.external_respondent_id, s.created_at, s.survey_done_at,
             s.released_at, s.declined_at, s.screened_out_at, s.reconciled_at,
             s.deleted_at,
             (select count(*) from released_records r where r.session_id = s.id)::int as records
      from sessions s where s.study_slug = ${slug}
      order by s.created_at
    `,
    sql<AnswerRow[]>`
      select a.session_id, a.question_code, a.row_code, a.value_text,
             a.value_number, a.value_codes, a.value_json
      from survey_answers a
      join sessions s on s.id = a.session_id
      where s.study_slug = ${slug}
    `,
    sql<{ session_id: string; passed: boolean }[]>`
      select f.session_id, f.passed from quality_flags f
      join sessions s on s.id = f.session_id where s.study_slug = ${slug}
    `,
    sql<{ session_id: string; name: string; value_text: string | null; value_number: number | null }[]>`
      select v.session_id, v.name, v.value_text, v.value_number
      from session_variables v
      join sessions s on s.id = v.session_id where s.study_slug = ${slug}
    `,
  ])

  const answerable = questions.filter(
    (q) => !['section', 'description', 'media', 'terminal'].includes(q.type)
  )

  const columns: Column[] = [
    { name: 'session_id', label: 'Session' },
    { name: 'respondent_id', label: "Referring platform's id", values: 'Append studies only' },
    { name: 'started_at', label: 'Started' },
    {
      name: 'status',
      label: 'How far they got',
      values:
        'started, screened_out, surveyed, declined, released, reconciled, deleted. A deleted case took part and later withdrew - the row is kept so the counts stay honest, and it is empty because we no longer hold anything.',
    },
    { name: 'records_released', label: 'Records released' },
    { name: 'quality_failures', label: 'Quality checks failed' },
    { name: 'quality_checks', label: 'Quality checks run' },
    ...variables.map((v) => ({
      name: v.name,
      label: v.label ?? v.name,
      values: v.kind === 'hidden' ? 'From the link' : 'Computed from answers',
    })),
    ...answerable.flatMap((q) => columnsFor(q, rawText)),
  ]

  const byId = new Map<string, Map<string, AnswerRow>>()
  for (const a of answers) {
    const map = byId.get(a.session_id) ?? new Map()
    map.set(`${a.question_code}#${a.row_code}`, a)
    byId.set(a.session_id, map)
  }
  const quality = new Map<string, { run: number; failed: number }>()
  for (const f of flags) {
    const q = quality.get(f.session_id) ?? { run: 0, failed: 0 }
    q.run++
    if (!f.passed) q.failed++
    quality.set(f.session_id, q)
  }
  const varsById = new Map<string, Map<string, string | number | null>>()
  for (const v of vars) {
    const map = varsById.get(v.session_id) ?? new Map()
    map.set(v.name, v.value_number ?? v.value_text)
    varsById.set(v.session_id, map)
  }

  const rows = sessions.map((s) => {
    const mine = byId.get(s.id) ?? new Map<string, AnswerRow>()
    const q = quality.get(s.id)
    const mineVars = varsById.get(s.id)

    // The furthest point reached, not a flag per stage. One column an analyst
    // can filter beats six they have to combine.
    const status = s.deleted_at
      ? 'deleted'
      : s.reconciled_at
      ? 'reconciled'
      : s.released_at
        ? 'released'
        : s.declined_at
          ? 'declined'
          : s.screened_out_at
            ? 'screened_out'
            : s.survey_done_at
              ? 'surveyed'
              : 'started'

    const cells: Cell[] = [
      s.id,
      s.external_respondent_id,
      s.created_at,
      status,
      s.records,
      q?.failed ?? null,
      q?.run ?? null,
      ...variables.map((v) => mineVars?.get(v.name) ?? null),
    ]

    for (const question of answerable) {
      const rowCodes = question.matrixRows?.length
        ? question.matrixRows.map((r) => r.code)
        : [0]

      for (const rowCode of rowCodes) {
        const a = mine.get(`${question.code}#${rowCode}`)

        switch (question.type) {
          case 'multiple': {
            const chosen = new Set(a?.value_codes ?? [])
            const codes = [
              ...question.options.map((o) => o.code),
              ...(question.allowOther ? [OTHER_CODE] : []),
              ...(question.allowPreferNotToSay ? [PREFER_NOT_CODE] : []),
            ]
            // Absent when they were never asked, 0 when they were and did not
            // pick it. Collapsing the two would turn a skipped branch into a
            // negative answer.
            for (const code of codes) cells.push(a ? (chosen.has(code) ? 1 : 0) : null)
            break
          }
          case 'ranking': {
            const order = a?.value_json?.order ?? []
            for (const option of question.options) {
              const at = order.indexOf(option.code)
              cells.push(at === -1 ? null : at + 1)
            }
            break
          }
          case 'allocation': {
            const parts = a?.value_json?.parts ?? {}
            for (const option of question.options) {
              cells.push(parts[String(option.code)] ?? (a ? 0 : null))
            }
            break
          }
          case 'text':
            cells.push(rawText ? (a?.value_text ?? null) : a ? '[withheld]' : null)
            break
          case 'date':
            cells.push(a?.value_text ?? null)
            break
          case 'single':
          case 'polar':
            cells.push(a?.value_codes?.[0] ?? null)
            break
          default:
            cells.push(a?.value_number ?? null)
        }

        if (question.allowOther) {
          const a2 = mine.get(`${question.code}#${rowCode}`)
          cells.push(rawText ? (a2?.value_text ?? null) : a2?.value_text ? '[withheld]' : null)
        }
      }
    }

    return cells
  })

  return { columns, rows }
}

/** What every column means. Delivered with the data, not on request. */
export async function codebookTable(slug: string, rawText: boolean): Promise<Table> {
  const { columns } = await responsesTable(slug, rawText)
  return {
    columns: [
      { name: 'column', label: 'Column' },
      { name: 'label', label: 'What it is' },
      { name: 'values', label: 'What the values mean' },
    ],
    rows: columns.map((c) => [c.name, c.label, c.values ?? '']),
  }
}

/**
 * The released records, one row each.
 *
 * Gated on the study's raw-text setting: with it off this still ships, because
 * counts and timings are the bulk of what a behavioural analysis uses, but
 * without what anybody typed or what an assistant said back.
 */
export async function recordsTable(slug: string, rawText: boolean): Promise<Table> {
  const rows = await db()<
    {
      session_id: string
      source: string
      occurred_at: string
      text: string
      answer: string | null
      citations: string[] | null
      passages: { text: string; citations: unknown[] }[] | null
    }[]
  >`
    select r.session_id, r.source, r.occurred_at, r.text, r.answer, r.citations, r.passages
    from released_records r
    join sessions s on s.id = r.session_id
    where s.study_slug = ${slug}
    order by r.session_id, r.occurred_at
  `

  const columns: Column[] = [
    { name: 'session_id', label: 'Session' },
    { name: 'source', label: 'Where it came from' },
    { name: 'occurred_at', label: 'When' },
    ...(rawText ? [{ name: 'text', label: 'What they typed' }] : []),
    { name: 'has_ai_answer', label: 'Came with a generated answer', values: '1 yes, 0 no' },
    { name: 'answer_words', label: 'Words in that answer' },
    { name: 'citations', label: 'Sources it cited' },
    { name: 'passages_total', label: 'Blocks in the answer' },
    { name: 'passages_cited', label: 'Blocks with a citation' },
    ...(rawText ? [{ name: 'answer', label: 'The answer itself' }] : []),
    ...(rawText ? [{ name: 'cited_urls', label: 'The URLs it cited' }] : []),
  ]

  return {
    columns,
    rows: rows.map((r) => {
      const passages = Array.isArray(r.passages) ? r.passages : []
      const cited = passages.filter((p) => (p.citations?.length ?? 0) > 0).length
      const cells: Cell[] = [
        r.session_id,
        r.source,
        r.occurred_at,
        ...(rawText ? [r.text] : []),
        r.answer ? 1 : 0,
        r.answer ? r.answer.split(/\s+/).filter(Boolean).length : 0,
        r.citations?.length ?? 0,
        passages.length,
        cited,
        ...(rawText ? [r.answer] : []),
        ...(rawText ? [(r.citations ?? []).join(' ')] : []),
      ]
      return cells
    }),
  }
}

/** What diverged, and what the respondent said about it. */
export async function reconcileTable(slug: string): Promise<Table> {
  const rows = await db()<
    {
      session_id: string
      question_code: string
      claimed: string
      observed: string
      agreed: boolean
      caveats: string[]
      explanation: string | null
      note: string | null
    }[]
  >`
    select r.session_id, r.question_code, r.claimed, r.observed, r.agreed,
           r.caveats, r.explanation, r.note
    from reconcile_responses r
    join sessions s on s.id = r.session_id
    where s.study_slug = ${slug}
    order by r.session_id, r.question_code
  `

  return {
    columns: [
      { name: 'session_id', label: 'Session' },
      { name: 'question', label: 'Question' },
      { name: 'claimed', label: 'What they said' },
      { name: 'observed', label: 'What their records showed' },
      { name: 'agreed', label: 'Did they agree', values: '1 yes, 0 no' },
      { name: 'caveats', label: 'Why the comparison may not mean what it looks like' },
      {
        name: 'explanation',
        label: 'What they said about the difference',
        values:
          'different_meaning is the one to watch - it says the question and the record were never measuring the same thing',
      },
      { name: 'note', label: 'In their own words' },
    ],
    rows: rows.map((r) => [
      r.session_id,
      r.question_code,
      r.claimed,
      r.observed,
      r.agreed ? 1 : 0,
      (r.caveats ?? []).join(' '),
      r.explanation,
      r.note,
    ]),
  }
}
