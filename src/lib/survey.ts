/**
 * The survey instrument.
 *
 * Questions come from the database per study. Validation lives here rather
 * than in the route so the client and the server agree on what "answered"
 * means - the form disables Continue using the same rules the server enforces.
 *
 * Nothing in this file may read a respondent's records. The survey completes
 * before they see any of them (invariant 2), and a question that adapts to
 * what we already hold would contaminate the self-report it exists to capture.
 */

import type { SourceKind } from './records'
import { evaluate, referencedCodes, type Condition } from './conditions'

/**
 * Everything that can sit in an instrument, answerable or not.
 *
 * Headings, prose, an image and an ending share the list with the questions
 * because they share the ordering and the branching - a paragraph only some
 * respondents need is an ordinary thing to want. What separates them is that
 * they collect nothing, which both the renderer and the validator read off the
 * type rather than being told separately.
 */
export type QuestionType =
  | 'single'
  | 'multiple'
  | 'scale'
  | 'number'
  | 'text'
  | 'date'
  | 'ranking'
  | 'allocation'
  | 'polar'
  | 'overlap'
  | 'section'
  | 'description'
  | 'media'
  | 'terminal'

const ANSWERABLE = new Set<QuestionType>([
  'single',
  'multiple',
  'scale',
  'number',
  'text',
  'date',
  'ranking',
  'allocation',
  'polar',
  'overlap',
])

export const isAnswerable = (type: QuestionType) => ANSWERABLE.has(type)

/**
 * An option, split into the part that must never move and the part that is
 * free to.
 *
 * `code` is the analysis key. It is assigned once and never edited, so a
 * column in a delivered file means the same thing in wave two as it did in
 * wave one. `label` is wording and may change as often as it needs to.
 * `mapsTo` is a separate binding read only by the claim engine - it is how an
 * option says "this one means Google AI Mode" without the data file having to
 * carry that string.
 */
export interface QuestionOption {
  code: number
  label: string
  mapsTo?: string
  /** Clears the other selections and is cleared by them. */
  exclusive?: boolean
}

/**
 * Reserved codes, the same in every study so a delivered file reads the same
 * way across them. Excluded from bases by default.
 */
export const OTHER_CODE = 97
export const PREFER_NOT_CODE = 98

export const isReservedCode = (code: number) =>
  code === OTHER_CODE || code === PREFER_NOT_CODE

/**
 * What record-side quantity a question is a self-report of.
 *
 * Declared when the instrument is authored, because congruence is only
 * measurable where a question and a record measure the same thing and that
 * correspondence cannot be recovered afterwards. The reconcile module consumes
 * this; nothing here scores it.
 */
export type Claim =
  /** Option values are source names; the set chosen is the claim. */
  | { kind: 'source_use' }
  /** The number given is a claimed count of records in the window. */
  | { kind: 'search_frequency'; sources: SourceKind[]; windowDays: number }
  /** A yes claims at least one record matching the terms. */
  | { kind: 'topic_search'; terms: string[]; windowDays: number }
  /**
   * The date given claims that is when they last did it. Compared against the
   * most recent matching record - the only claim here about *when* rather than
   * how much, and the one people are worst at.
   */
  | {
      kind: 'recency'
      sources: SourceKind[]
      terms?: string[]
    }
  /**
   * The order given claims that is how much they use each, most first. Compared
   * against the ordering by record count. A relative claim, which people answer
   * far better than they answer a count.
   */
  | { kind: 'rank_frequency'; windowDays: number }
  /**
   * The split given claims that is how their activity divides. Compared
   * against the actual composition of records, which is what a client usually
   * means when they ask about share.
   */
  | { kind: 'share'; windowDays: number }

export interface Question {
  code: string
  position: number
  page: number
  type: QuestionType
  prompt: string
  help?: string
  options: QuestionOption[]
  required: boolean
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
  claim?: Claim
  /** Asked only when this holds. Absent means always asked. */
  showIf?: Condition
  /** Ends the interview when this holds, evaluated on leaving the page. */
  terminateIf?: Condition

  /**
   * The things this question is asked about, one answer per row.
   *
   * A matrix is a modifier rather than a family of types: it is the same
   * question repeated, so the scale is authored once and the renderer is free
   * to draw a grid on a wide screen and a stacked list on a phone without the
   * stored answers differing at all.
   */
  matrixRows?: QuestionOption[]

  allowOther?: boolean
  allowPreferNotToSay?: boolean
  minSelections?: number
  maxSelections?: number

  /**
   * How to draw it, where the drawing does not change the data.
   *
   * A star rating, a slider, a smiley face, a thermometer and a numbered scale
   * all store one number in a range. Making each a type would mean a validator,
   * a storage shape and a comparison per widget - identical, and free to drift.
   */
  display?: Display

  /**
   * One label per scale point, in order.
   *
   * The labels are the author's to change; the values under them are the
   * positions and are not, which is the same split as option codes. A wave two
   * that relabels "Somewhat agree" still means 4.
   */
  pointLabels?: string[]

  /** overlap only. */
  staticLabel?: string
  staticImage?: string
  movingLabel?: string

  /** media elements only. */
  mediaUrl?: string
  mediaAlt?: string

  /**
   * Marks an ordinary question as a data-quality instrument. Failing one flags
   * the session and never ends it - see src/lib/quality.ts.
   */
  qualityCheck?: QualityCheck
}

/**
 * Widgets that leave the data alone.
 *
 * `nps` is the exception worth naming: it fixes the range at 0 to 10 and the
 * wording, because a Net Promoter Score that is not on that scale is not a Net
 * Promoter Score and comparing it to a benchmark would be wrong.
 */
export type Display =
  | 'numbers'
  | 'stars'
  | 'hearts'
  | 'thumbs'
  | 'slider'
  | 'smiley'
  | 'thermometer'
  | 'nps'
  | 'differential'
  | 'dropdown'
  | 'images'

/** The fixed range a display insists on, if it insists on one. */
export function displayRange(display?: Display): { min: number; max: number } | null {
  if (display === 'nps') return { min: 0, max: 10 }
  if (display === 'thermometer') return { min: 0, max: 100 }
  return null
}

export interface QualityCheck {
  kind: 'attention' | 'red_herring' | 'duplicate' | 'gibberish'
  expect?: number[]
  of?: string
}

/** Not a matrix. Row codes start at 1, so 0 can mean "no row". */
export const NO_ROW = 0

/**
 * How an answer is keyed while the respondent is working.
 *
 * A matrix answer belongs to one row, so the key carries it. Flat keys keep
 * the client state a plain object and the branching rules addressing whole
 * questions rather than cells.
 */
export function answerKey(code: string, rowCode: number = NO_ROW): string {
  return rowCode === NO_ROW ? code : `${code}#${rowCode}`
}

/** One screen. Questions sharing a page number are answered together. */
export interface Page {
  page: number
  questions: Question[]
}

/**
 * An answer in the shape the respondent gave it. Discriminating on the
 * question type rather than the value keeps "0" and "" from being mistaken for
 * unanswered, which is the classic way a survey loses real data.
 */
export type AnswerValue =
  /**
   * Selection, as codes. A single choice is one code rather than a separate
   * shape - the difference between "pick one" and "pick several" is a rule
   * about how many, not a different kind of answer.
   *
   * `text` rides along when code 97 is chosen, which is what "other, please
   * specify" means: a selection and a verbatim, not one or the other.
   */
  | { kind: 'codes'; codes: number[]; text?: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  /** Ranking: most preferred first. */
  | { kind: 'order'; codes: number[] }
  /** Allocation: option code to quantity. */
  | { kind: 'allocation'; parts: Record<number, number> }
  /** A calendar day, as yyyy-mm-dd. No time, because nobody remembers one. */
  | { kind: 'date'; value: string }

export type Answers = Record<string, AnswerValue | undefined>

/**
 * Whether a question is asked, given what has been answered so far.
 *
 * A question whose condition references one that was itself skipped is also
 * skipped, because the referenced answer is absent and every comparison
 * against an absent answer is false. That cascade is the intended behaviour:
 * a follow-up to a follow-up should not surface on its own.
 */
export function isVisible(question: Question, answers: Answers): boolean {
  return question.showIf ? evaluate(question.showIf, answers) : true
}

export function visibleQuestions(
  questions: Question[],
  answers: Answers
): Question[] {
  return questions.filter((q) => isVisible(q, answers))
}

/**
 * Pages, with skipped questions removed and pages that empty out dropped.
 *
 * Recomputed on every answer rather than fixed at the start, so the progress
 * indicator reflects the route this respondent is actually on. It will move as
 * they answer - a branch that opens three more questions genuinely does make
 * the interview longer, and a bar that pretends otherwise is a worse lie than
 * one that shifts.
 */
export function groupIntoPages(
  questions: Question[],
  answers: Answers = {}
): Page[] {
  const byPage = new Map<number, Question[]>()
  for (const question of [...questions].sort((a, b) => a.position - b.position)) {
    if (!isVisible(question, answers)) continue
    const list = byPage.get(question.page) ?? []
    list.push(question)
    byPage.set(question.page, list)
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, qs]) => ({ page, questions: qs }))
}

/**
 * Drops answers to questions that are not asked on this respondent's route.
 *
 * Someone who answers a follow-up and then changes the answer that opened it
 * must not have the orphaned reply delivered - the client would be reading
 * responses to a question this person was never shown. Pruning happens at
 * submit rather than as they type, so going back and forth over a branch does
 * not destroy work they may return to.
 */
export function pruneAnswers(
  questions: Question[],
  answers: Answers
): Answers {
  const asked = new Set(visibleQuestions(questions, answers).map((q) => q.code))
  const out: Answers = {}
  for (const [key, value] of Object.entries(answers)) {
    // A matrix answer is keyed "question#row"; visibility is a property of the
    // question, so the row is dropped before the check.
    const [code] = key.split('#')
    if (asked.has(code) && value !== undefined) out[key] = value
  }
  return out
}

/**
 * The first question whose termination rule fires, or null.
 *
 * Only questions the respondent was actually shown can screen them out. A rule
 * on a skipped question refers to a page they never saw.
 */
export function terminatedBy(
  questions: Question[],
  answers: Answers
): Question | null {
  for (const question of visibleQuestions(questions, answers)) {
    // A terminal element ends things by being reached at all. Its show_if is
    // the routing: "if they got this far, they are done."
    if (question.type === 'terminal') return question
    if (question.terminateIf && evaluate(question.terminateIf, answers)) {
      return question
    }
  }
  return null
}

/**
 * Rules that reference a later question, which can therefore never fire.
 *
 * Returned rather than thrown so a questionnaire with one bad rule still
 * fields; the caller logs it. A silent never-firing branch is the failure mode
 * worth spending code to avoid, because it looks exactly like a branch that
 * nobody happened to match.
 */
export function forwardReferences(
  questions: Question[]
): { code: string; references: string[] }[] {
  const positions = new Map(questions.map((q) => [q.code, q.position]))
  const problems: { code: string; references: string[] }[] = []

  for (const question of questions) {
    // The two rules see different things. `show_if` decides whether to ask,
    // so it must look strictly backwards - a question cannot depend on its own
    // answer to decide whether it is asked. `terminate_if` is evaluated once
    // the page has been answered, so referring to its own question is not only
    // legal but the usual way a screen-out is written.
    const bad = [
      ...(question.showIf ? referencedCodes(question.showIf) : []).filter(
        (code) => {
          const at = positions.get(code)
          return at === undefined || at >= question.position
        }
      ),
      ...(question.terminateIf ? referencedCodes(question.terminateIf) : []).filter(
        (code) => {
          const at = positions.get(code)
          return at === undefined || at > question.position
        }
      ),
    ]
    if (bad.length) {
      problems.push({ code: question.code, references: [...new Set(bad)] })
    }
  }

  return problems
}

/**
 * Returns a reason the answer is unusable, or null if it is fine.
 *
 * Shared by the form and the route. A required question that is genuinely
 * optional to the server, or vice versa, is the kind of drift that only shows
 * up as missing data in the delivered file.
 */
export function validateAnswer(
  question: Question,
  answer: AnswerValue | undefined
): string | null {
  // A heading cannot be answered wrongly, or at all.
  if (!isAnswerable(question.type)) return null

  if (!answer) {
    return question.required ? 'This one is needed to continue.' : null
  }

  switch (question.type) {
    case 'single':
    case 'multiple': {
      if (answer.kind !== 'codes') return 'Expected a choice.'
      const offered = new Set(question.options.map((o) => o.code))
      if (question.allowOther) offered.add(OTHER_CODE)
      if (question.allowPreferNotToSay) offered.add(PREFER_NOT_CODE)

      for (const code of answer.codes) {
        if (!offered.has(code)) return 'That is not one of the options.'
      }
      if (new Set(answer.codes).size !== answer.codes.length) {
        return 'The same option was chosen twice.'
      }
      if (question.type === 'single' && answer.codes.length > 1) {
        return 'Only one answer here.'
      }
      // "Other" without the words is half an answer, and the half that
      // carries the meaning is the missing one.
      if (answer.codes.includes(OTHER_CODE) && !answer.text?.trim()) {
        return 'Tell us what the other one was.'
      }
      if (!answer.codes.length) {
        return question.required ? 'This one is needed to continue.' : null
      }

      // Limits ignore "prefer not to say": it is a refusal, not a pick, and
      // counting it against a minimum would force someone to choose.
      const picked = answer.codes.filter((c) => c !== PREFER_NOT_CODE).length
      if (question.minSelections && picked && picked < question.minSelections) {
        return `Choose at least ${question.minSelections}.`
      }
      if (question.maxSelections && picked > question.maxSelections) {
        return `Choose no more than ${question.maxSelections}.`
      }
      return null
    }

    case 'polar': {
      // Two poles, one chosen. Stored as a selection so it reads like one in
      // the data, and so a polar battery lines up with a segmentation spec.
      if (answer.kind !== 'codes') return 'Expected one of the two.'
      const offered = new Set(question.options.map((o) => o.code))
      if (answer.codes.length !== 1 || !offered.has(answer.codes[0])) {
        return 'Choose one side or the other.'
      }
      return null
    }

    case 'overlap': {
      if (answer.kind !== 'number') return 'Expected a position.'
      if (answer.value < -100 || answer.value > 100) {
        return 'That is outside the range.'
      }
      return null
    }

    case 'scale':
    case 'number': {
      if (answer.kind !== 'number') return 'Expected a number.'
      // A display can fix the range, and where it does it wins over whatever
      // the author typed - an NPS on a 1-to-7 scale is not an NPS.
      const fixed = displayRange(question.display)
      if (fixed && (answer.value < fixed.min || answer.value > fixed.max)) {
        return `Choose between ${fixed.min} and ${fixed.max}.`
      }
      if (!Number.isFinite(answer.value)) return 'That is not a number.'
      if (question.min !== undefined && answer.value < question.min) {
        return `The lowest is ${question.min}.`
      }
      if (question.max !== undefined && answer.value > question.max) {
        return `The highest is ${question.max}.`
      }
      if (question.type === 'scale' && !Number.isInteger(answer.value)) {
        return 'Choose one of the points.'
      }
      return null
    }

    case 'date': {
      if (answer.kind !== 'date') return 'Expected a date.'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(answer.value)) return 'That is not a date.'
      const at = new Date(`${answer.value}T00:00:00Z`).getTime()
      if (Number.isNaN(at)) return 'That is not a date.'
      // A date in the future is not a memory, it is a typo.
      if (at > Date.now() + 86400_000) return 'That day has not happened yet.'
      return null
    }

    case 'ranking': {
      if (answer.kind !== 'order') return 'Expected an order.'
      const offered = new Set(question.options.map((o) => o.code))
      for (const code of answer.codes) {
        if (!offered.has(code)) return 'That is not one of the options.'
      }
      if (new Set(answer.codes).size !== answer.codes.length) {
        return 'Something is ranked twice.'
      }
      // Partial orders are allowed - a top-three is a real question - but a
      // half-finished drag is not, so anything started must be finished up to
      // the limit the author set.
      const wanted = question.maxSelections ?? question.options.length
      if (answer.codes.length && answer.codes.length < wanted) {
        return `Put ${wanted} in order.`
      }
      if (!answer.codes.length && question.required) {
        return 'This one is needed to continue.'
      }
      return null
    }

    case 'allocation': {
      if (answer.kind !== 'allocation') return 'Expected an allocation.'
      const offered = new Set(question.options.map((o) => o.code))
      let total = 0
      for (const [code, amount] of Object.entries(answer.parts)) {
        if (!offered.has(Number(code))) return 'That is not one of the options.'
        if (!Number.isFinite(amount) || amount < 0) return 'Use whole amounts.'
        total += amount
      }
      // The total is the point of the type: a split that does not add up is
      // not a split, and letting it through would deliver shares that cannot
      // be compared to anything.
      const target = question.max ?? 100
      if (total !== target) {
        return `That adds up to ${total}. It needs to be ${target}.`
      }
      return null
    }

    case 'text': {
      if (answer.kind !== 'text') return 'Expected text.'
      if (answer.value.length > MAX_TEXT_ANSWER) return 'That is too long.'
      if (!answer.value.trim() && question.required) {
        return 'This one is needed to continue.'
      }
      return null
    }

    // Unreachable: isAnswerable already returned for these. Written out so a
    // type added later fails here rather than falling through as valid.
    default:
      return null
  }
}

export const MAX_TEXT_ANSWER = 5_000

/** Re-exported so callers touch one module for the instrument. */
export type { Condition } from './conditions'

export function pageIsComplete(page: Page, answers: Answers): boolean {
  return page.questions.every((q) => validateAnswer(q, answers[q.code]) === null)
}

/** The points a scale renders, inclusive of both ends. */
export function scalePoints(question: Question): number[] {
  const min = question.min ?? 1
  const max = question.max ?? 5
  const points: number[] = []
  for (let n = min; n <= max; n++) points.push(n)
  return points
}
