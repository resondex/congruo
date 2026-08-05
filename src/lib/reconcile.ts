/**
 * Comparing what the respondent said against what their records show.
 *
 * The arithmetic is here and is pure, so it can be reasoned about and tested
 * without a database. Loading the inputs and storing the explanations lives in
 * `reconcile_store.ts`.
 *
 * The single most important thing in this file is that a divergence is not
 * evidence of misreporting. It is the difference between a claim and *the
 * subset of records the respondent chose to release*, over *whatever period
 * their archive happens to cover*. Those two confounds are real, common, and
 * invisible unless stated - so every comparison carries its caveats, and the
 * respondent is asked rather than told.
 */

import type { SourceKind } from './records'
import { SOURCE_LABELS } from './records'
import type { AnswerValue, Claim, Question } from './survey'

export interface ObservedRecord {
  source: SourceKind
  occurredAt: string
  text: string
}

/**
 * Why a comparison may not mean what it appears to.
 *
 * These are shown to the respondent, not just logged. Presenting "you said 40,
 * we see 3" without saying "you held 300 records back" would be an accusation
 * built from our own missing data.
 */
export type Caveat =
  /** Records were withheld at review, so absence here is not absence. */
  | 'records_withheld'
  /** The archive spans less than the window the question asked about. */
  | 'short_coverage'
  /** Nothing was released for a source the question asks about. */
  | 'source_absent'

export interface Comparison {
  questionCode: string
  prompt: string
  kind: Claim['kind']
  /** The self-report, in words the respondent will recognise. */
  claimed: string
  /** The record side, same. */
  observed: string
  agrees: boolean
  caveats: Caveat[]
}

export interface ReconcileInput {
  questions: Question[]
  answers: Record<string, AnswerValue | undefined>
  records: ObservedRecord[]
  withheldCount: number
  /** Sources the respondent granted at consent. */
  grantedSources: SourceKind[]
  /** When the release happened; the anchor for every "last N days" window. */
  releasedAt: Date
}

const DAY = 24 * 60 * 60 * 1000

function withinWindow(
  record: ObservedRecord,
  releasedAt: Date,
  windowDays: number
): boolean {
  const at = new Date(record.occurredAt).getTime()
  if (Number.isNaN(at)) return false
  return at >= releasedAt.getTime() - windowDays * DAY && at <= releasedAt.getTime()
}

/**
 * Whether the released archive actually spans the window a question asked
 * about.
 *
 * Comparing a 30-day claim against five days of history manufactures a
 * discrepancy out of nothing. Half the window is the threshold: below that the
 * comparison is not worth putting to someone as though it meant something.
 */
function coverageIsShort(
  records: ObservedRecord[],
  releasedAt: Date,
  windowDays: number
): boolean {
  if (!records.length) return true
  const times = records
    .map((r) => new Date(r.occurredAt).getTime())
    .filter((t) => !Number.isNaN(t))
  if (!times.length) return true
  const earliest = Math.min(...times)
  const span = Math.min(releasedAt.getTime(), Math.max(...times)) - earliest
  return span < (windowDays * DAY) / 2
}

/**
 * How far a count may be off before it is worth raising.
 *
 * Frequency self-reports are estimates and everyone knows it - the question
 * even says "roughly". A fixed threshold would flag 2 against 5 while ignoring
 * 200 against 260, which is backwards. So: within three, or within a factor of
 * two, counts as agreement.
 */
function countsAgree(claimed: number, observed: number): boolean {
  if (Math.abs(claimed - observed) <= 3) return true
  const low = Math.min(claimed, observed)
  const high = Math.max(claimed, observed)
  if (low === 0) return false
  return high / low <= 2
}

const listOf = (labels: string[]) =>
  labels.length === 0
    ? 'none'
    : labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`

function matchesTerms(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase()
  return terms.some((term) => haystack.includes(term.toLowerCase()))
}

/**
 * Builds the comparisons to put to the respondent.
 *
 * Questions with no claim are skipped: without a declared correspondence there
 * is nothing to compare, and guessing one from the wording is exactly the
 * inference this design refuses to make.
 */
export function reconcile(input: ReconcileInput): Comparison[] {
  const { questions, answers, records, releasedAt } = input
  const out: Comparison[] = []

  for (const question of questions) {
    const claim = question.claim
    const answer = answers[question.code]
    if (!claim || !answer) continue

    const caveats: Caveat[] = []
    if (input.withheldCount > 0) caveats.push('records_withheld')

    switch (claim.kind) {
      case 'source_use': {
        if (answer.kind !== 'choices') continue

        // Only sources this respondent granted are comparable. One they never
        // consented to share could not appear in the records whatever they
        // did, and holding that against their answer would be nonsense.
        const comparable = question.options
          .map((o) => o.value as SourceKind)
          .filter((v) => input.grantedSources.includes(v))
        if (!comparable.length) continue

        const said = new Set(
          answer.values.filter((v) => comparable.includes(v as SourceKind))
        )
        const seen = new Set(
          records.map((r) => r.source).filter((s) => comparable.includes(s))
        )

        const saidNotSeen = [...said].filter((s) => !seen.has(s as SourceKind))
        const seenNotSaid = [...seen].filter((s) => !said.has(s))

        const label = (s: string) => SOURCE_LABELS[s as SourceKind] ?? s
        if (saidNotSeen.length && !records.length) caveats.push('source_absent')

        out.push({
          questionCode: question.code,
          prompt: question.prompt,
          kind: claim.kind,
          claimed: listOf([...said].map(label)),
          observed: listOf([...seen].map(label)),
          agrees: saidNotSeen.length === 0 && seenNotSaid.length === 0,
          caveats,
        })
        break
      }

      case 'search_frequency': {
        if (answer.kind !== 'number') continue

        const relevant = records.filter(
          (r) =>
            claim.sources.includes(r.source) &&
            withinWindow(r, releasedAt, claim.windowDays)
        )
        if (coverageIsShort(records, releasedAt, claim.windowDays)) {
          caveats.push('short_coverage')
        }
        if (!relevant.length) caveats.push('source_absent')

        out.push({
          questionCode: question.code,
          prompt: question.prompt,
          kind: claim.kind,
          claimed: `about ${answer.value}`,
          observed: `${relevant.length} in what you shared`,
          agrees: countsAgree(answer.value, relevant.length),
          caveats,
        })
        break
      }

      case 'topic_search': {
        if (answer.kind !== 'choice') continue

        const hits = records.filter(
          (r) =>
            withinWindow(r, releasedAt, claim.windowDays) &&
            // Matched on what they typed, not on what an AI answered them. An
            // answer that happens to mention insurance is not evidence that
            // they looked into insurance.
            matchesTerms(r.text, claim.terms)
        )
        if (coverageIsShort(records, releasedAt, claim.windowDays)) {
          caveats.push('short_coverage')
        }

        const saidYes = answer.value === 'yes'
        out.push({
          questionCode: question.code,
          prompt: question.prompt,
          kind: claim.kind,
          claimed: saidYes ? 'yes' : 'no',
          observed: hits.length
            ? `${hits.length} matching ${hits.length === 1 ? 'search' : 'searches'}`
            : 'nothing matching',
          agrees: saidYes === hits.length > 0,
          caveats,
        })
        break
      }
    }
  }

  return out
}

export type Explanation =
  | 'misremembered'
  | 'not_me'
  | 'withheld'
  | 'different_meaning'
  | 'other_device'
  | 'record_wrong'
  | 'other'

/**
 * The options offered against a divergence.
 *
 * Deliberately led by the explanations that put the fault anywhere but on the
 * respondent, because the first option in a list is the one people take and we
 * would rather over-collect "the record is not what you think" than nudge
 * someone into confessing to a bad memory they did not have.
 */
export const EXPLANATIONS: { value: Explanation; label: string }[] = [
  { value: 'different_meaning', label: 'I did not count that as the same thing' },
  { value: 'withheld', label: 'I chose not to share some of those' },
  { value: 'other_device', label: 'I did it somewhere this file does not cover' },
  { value: 'not_me', label: 'Someone else was using my account' },
  { value: 'misremembered', label: 'I misremembered - the record looks right' },
  { value: 'record_wrong', label: 'The record does not look right to me' },
  { value: 'other', label: 'Something else' },
]

export const MAX_NOTE = 2_000
