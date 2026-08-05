/**
 * Conditions for branching and skip logic.
 *
 * Deliberately a small, closed language rather than an expression to evaluate.
 * These rules decide what each respondent was actually asked, which means they
 * end up in the method section of whatever the client publishes - they have to
 * be readable by someone who is not going to run them. It also means no
 * `eval`, no string parsing, and no way for a questionnaire to do anything but
 * compare answers it already has.
 *
 * Every operator is total: a condition that references an unanswered question
 * is false, never an error. A questionnaire that throws halfway down a page
 * would strand a respondent with no way to continue.
 */

import type { AnswerValue, Answers } from './survey'

export type Operator =
  | 'is'
  | 'is_not'
  | 'includes'
  | 'excludes'
  | 'gte'
  | 'lte'
  | 'gt'
  | 'lt'
  | 'answered'
  | 'not_answered'

export interface Test {
  /** The code of an earlier question. */
  q: string
  op: Operator
  value?: string | number
}

export type Condition =
  | Test
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }

/** The choices an answer represents, whatever shape it was stored in. */
function choicesOf(answer: AnswerValue): string[] {
  switch (answer.kind) {
    case 'choice':
      return [answer.value]
    case 'choices':
      return answer.values
    case 'text':
      return [answer.value]
    case 'number':
      return [String(answer.value)]
  }
}

function numberOf(answer: AnswerValue): number | null {
  if (answer.kind === 'number') return answer.value
  return null
}

function isAnswered(answer: AnswerValue | undefined): boolean {
  if (!answer) return false
  switch (answer.kind) {
    case 'choices':
      return answer.values.length > 0
    case 'text':
      return answer.value.trim().length > 0
    default:
      return true
  }
}

function evaluateTest(test: Test, answers: Answers): boolean {
  const answer = answers[test.q]

  if (test.op === 'answered') return isAnswered(answer)
  if (test.op === 'not_answered') return !isAnswered(answer)

  // Every remaining operator compares against something. An unanswered
  // question satisfies none of them - including `is_not`, which is the one
  // that tempts you to say otherwise. "Did not say yes" and "was never asked"
  // are different states, and treating the second as the first is how a
  // branch fires for someone who never reached the question it depends on.
  if (!isAnswered(answer) || answer === undefined) return false

  switch (test.op) {
    case 'is':
      return choicesOf(answer).length === 1 && choicesOf(answer)[0] === test.value
    case 'is_not':
      return !(choicesOf(answer).length === 1 && choicesOf(answer)[0] === test.value)
    case 'includes':
      return choicesOf(answer).includes(String(test.value))
    case 'excludes':
      return !choicesOf(answer).includes(String(test.value))
    case 'gte':
    case 'lte':
    case 'gt':
    case 'lt': {
      const left = numberOf(answer)
      const right = typeof test.value === 'number' ? test.value : Number(test.value)
      if (left === null || !Number.isFinite(right)) return false
      if (test.op === 'gte') return left >= right
      if (test.op === 'lte') return left <= right
      if (test.op === 'gt') return left > right
      return left < right
    }
  }
}

export function evaluate(condition: Condition, answers: Answers): boolean {
  if ('all' in condition) {
    return condition.all.every((c) => evaluate(c, answers))
  }
  if ('any' in condition) {
    return condition.any.some((c) => evaluate(c, answers))
  }
  if ('not' in condition) {
    return !evaluate(condition.not, answers)
  }
  return evaluateTest(condition, answers)
}

/**
 * Rejects a condition that is not one of the shapes above.
 *
 * Conditions come out of the database as arbitrary jsonb, and a typo in a
 * questionnaire should surface as "this rule is malformed" at load rather than
 * as a branch that silently never fires for anybody.
 */
export function isCondition(value: unknown): value is Condition {
  if (typeof value !== 'object' || value === null) return false

  if ('all' in value || 'any' in value) {
    const list = (value as { all?: unknown; any?: unknown }).all ??
      (value as { any?: unknown }).any
    return Array.isArray(list) && list.length > 0 && list.every(isCondition)
  }
  if ('not' in value) {
    return isCondition((value as { not: unknown }).not)
  }

  const { q, op, value: operand } = value as Record<string, unknown>
  if (typeof q !== 'string' || !q) return false
  if (typeof op !== 'string') return false
  const needsOperand = op !== 'answered' && op !== 'not_answered'
  if (
    !(
      [
        'is',
        'is_not',
        'includes',
        'excludes',
        'gte',
        'lte',
        'gt',
        'lt',
        'answered',
        'not_answered',
      ] as string[]
    ).includes(op)
  ) {
    return false
  }
  if (needsOperand && typeof operand !== 'string' && typeof operand !== 'number') {
    return false
  }
  return true
}

/** Every question code a condition depends on, for cycle and order checks. */
export function referencedCodes(condition: Condition): string[] {
  if ('all' in condition) return condition.all.flatMap(referencedCodes)
  if ('any' in condition) return condition.any.flatMap(referencedCodes)
  if ('not' in condition) return referencedCodes(condition.not)
  return [condition.q]
}
