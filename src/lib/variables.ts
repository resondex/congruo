import { evaluate, type Condition } from './conditions'
import type { Answers } from './survey'

/**
 * Variables that are not answers.
 *
 * Hidden ones arrive on the link and are stored without ever being shown -
 * sample source, quota cell, the client's own identifiers. Derived ones are
 * computed from the answers afterwards: nets, segments, banner points.
 *
 * Both end up as columns beside the answers, which is the point. A client who
 * has to join three files to cross a segment by a question will do it wrong
 * once and then stop trusting the data.
 */

export type VariableKind = 'hidden' | 'derived'

export interface Bucket {
  code: number
  label: string
  when: Condition
}

/**
 * First match wins.
 *
 * That is how a net or a banner point is written by hand, and it makes an
 * overlapping set of rules produce one defensible answer instead of an
 * arbitrary one. The order is the definition, so reordering buckets changes
 * the variable and is not a cosmetic edit.
 */
export interface DerivedRule {
  buckets: Bucket[]
  /** Where anything unmatched lands. Without it, unmatched is simply absent. */
  otherwise?: { code: number; label: string }
}

export interface StudyVariable {
  name: string
  label?: string
  kind: VariableKind
  /** hidden: the query parameter to read. */
  sourceParam?: string
  /** derived: the recode. */
  rule?: DerivedRule
  position: number
}

export interface VariableValue {
  name: string
  text?: string
  number?: number
}

const MAX_HIDDEN_LENGTH = 200

/**
 * Reads the hidden variables off a link.
 *
 * Values are taken as text and truncated. They come from a URL, which means
 * they come from whoever built the link rather than from us, and a hidden
 * variable is not a place to accept unbounded input just because nobody sees
 * it - it still lands in a file a client opens.
 */
export function readHidden(
  variables: StudyVariable[],
  params: URLSearchParams | Record<string, string | string[] | undefined>
): VariableValue[] {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  const out: VariableValue[] = []
  for (const variable of variables) {
    if (variable.kind !== 'hidden' || !variable.sourceParam) continue
    const raw = get(variable.sourceParam)
    if (raw === undefined || raw === '') continue

    const text = raw.slice(0, MAX_HIDDEN_LENGTH)
    const asNumber = Number(text)
    out.push({
      name: variable.name,
      text,
      // Kept in both columns when it is numeric, so a quota cell of "3" can be
      // crossed as a number without the client having to cast it.
      number: text !== '' && Number.isFinite(asNumber) ? asNumber : undefined,
    })
  }
  return out
}

/**
 * Computes the derived variables from a completed set of answers.
 *
 * Every rule is a condition over answers, so a derived variable can only ever
 * be a function of what the respondent said. It cannot read their records -
 * that would make the self-report a function of the thing it is meant to be
 * compared against, which is the one circularity this whole design is arranged
 * to avoid.
 */
export function derive(
  variables: StudyVariable[],
  answers: Answers
): VariableValue[] {
  const out: VariableValue[] = []

  for (const variable of variables) {
    if (variable.kind !== 'derived' || !variable.rule) continue

    const hit = variable.rule.buckets.find((b) => evaluate(b.when, answers))
    const result = hit ?? variable.rule.otherwise
    if (!result) continue

    out.push({
      name: variable.name,
      number: result.code,
      text: 'label' in result ? result.label : undefined,
    })
  }

  return out
}

/** Names a study already uses, so a new variable cannot collide with one. */
export function nameProblem(
  name: string,
  taken: Set<string>
): string | null {
  if (!/^[a-z0-9_]{2,60}$/.test(name)) {
    return 'Use lowercase letters, numbers and underscores.'
  }
  if (taken.has(name)) {
    return 'A question or variable already uses that name.'
  }
  return null
}
