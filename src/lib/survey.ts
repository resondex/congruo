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

export type QuestionType = 'single' | 'multiple' | 'scale' | 'number' | 'text'

export interface QuestionOption {
  value: string
  label: string
}

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
  | { kind: 'choice'; value: string }
  | { kind: 'choices'; values: string[] }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }

export type Answers = Record<string, AnswerValue | undefined>

export function groupIntoPages(questions: Question[]): Page[] {
  const byPage = new Map<number, Question[]>()
  for (const question of [...questions].sort((a, b) => a.position - b.position)) {
    const list = byPage.get(question.page) ?? []
    list.push(question)
    byPage.set(question.page, list)
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, qs]) => ({ page, questions: qs }))
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
  if (!answer) {
    return question.required ? 'This one is needed to continue.' : null
  }

  switch (question.type) {
    case 'single': {
      if (answer.kind !== 'choice') return 'Expected a single choice.'
      if (!question.options.some((o) => o.value === answer.value)) {
        return 'That is not one of the options.'
      }
      return null
    }

    case 'multiple': {
      if (answer.kind !== 'choices') return 'Expected a list of choices.'
      for (const value of answer.values) {
        if (!question.options.some((o) => o.value === value)) {
          return 'That is not one of the options.'
        }
      }
      if (new Set(answer.values).size !== answer.values.length) {
        return 'The same option was chosen twice.'
      }
      // An empty selection is a real answer to "choose all that apply" only
      // when the question is optional; otherwise it is a skipped question
      // wearing a different hat.
      if (!answer.values.length && question.required) {
        return 'This one is needed to continue.'
      }
      return null
    }

    case 'scale':
    case 'number': {
      if (answer.kind !== 'number') return 'Expected a number.'
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

    case 'text': {
      if (answer.kind !== 'text') return 'Expected text.'
      if (answer.value.length > MAX_TEXT_ANSWER) return 'That is too long.'
      if (!answer.value.trim() && question.required) {
        return 'This one is needed to continue.'
      }
      return null
    }
  }
}

export const MAX_TEXT_ANSWER = 5_000

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
