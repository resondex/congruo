import type { Answers, Question } from './survey'
import { OTHER_CODE, PREFER_NOT_CODE } from './survey'

/**
 * Data-quality instruments.
 *
 * These FLAG. They never end an interview, and that is a research decision
 * rather than a kindness: a respondent who fails an attention check still has
 * entirely valid records, and only their self-report is in doubt. Screening
 * them out would throw away half of a usable case and would also make the
 * failure rate unmeasurable - and the failure rate is a number a client asks
 * for, because it is how they judge the sample.
 */

export type QualityKind =
  /** A question that tells the respondent which answer to give. */
  | 'attention'
  /** Any answer is wrong, because the thing asked about does not exist. */
  | 'red_herring'
  /** Repeats an earlier question; the two answers should agree. */
  | 'duplicate'
  /** Open text that is not language. */
  | 'gibberish'

export interface QualityCheck {
  kind: QualityKind
  /** attention: the codes that count as following the instruction. */
  expect?: number[]
  /** duplicate: the earlier question this should agree with. */
  of?: string
}

export interface QualityResult {
  questionCode: string
  kind: QualityKind
  passed: boolean
  detail?: string
}

/**
 * Whether a string looks like someone typing rather than someone answering.
 *
 * Deliberately forgiving. A short answer is not gibberish - "no" is a complete
 * reply to plenty of questions - and a false accusation here costs a real case,
 * while a missed one costs a little noise. So it only fires on the shapes that
 * have no innocent reading: no vowels at any length, or one character held
 * down, or the home row.
 */
function looksLikeGibberish(text: string): boolean {
  const cleaned = text.trim().toLowerCase()
  if (cleaned.length < 8) return false
  if (/^(.)\1+$/.test(cleaned.replace(/\s/g, ''))) return true
  if (/(asdf|qwer|zxcv|jkl;|hjkl){2,}/.test(cleaned)) return true
  const letters = cleaned.replace(/[^a-z]/g, '')
  if (letters.length >= 10 && !/[aeiou]/.test(letters)) return true
  return false
}

/**
 * Runs every check the instrument carries.
 *
 * Only questions the respondent actually saw are checked. A trap inside a
 * branch they never entered is not a failure, and counting it as one would
 * penalise people for the route their honest answers took.
 */
export function runQualityChecks(
  questions: Question[],
  answers: Answers,
  wasShown: (code: string) => boolean
): QualityResult[] {
  const out: QualityResult[] = []

  for (const question of questions) {
    const check = question.qualityCheck
    if (!check || !wasShown(question.code)) continue

    const answer = answers[question.code]
    let passed = true
    let detail: string | undefined

    switch (check.kind) {
      case 'attention': {
        if (!answer || answer.kind !== 'codes') {
          passed = false
          detail = 'not answered'
          break
        }
        const expected = new Set(check.expect ?? [])
        const given = new Set(answer.codes)
        passed =
          expected.size === given.size &&
          [...expected].every((code) => given.has(code))
        if (!passed) detail = `gave ${[...given].join(',') || 'nothing'}`
        break
      }

      case 'red_herring': {
        // Choosing anything real is the failure. "Prefer not to say" is not a
        // claim to have heard of it, so it does not count against them.
        if (!answer || answer.kind !== 'codes') break
        const claimed = answer.codes.filter(
          (c) => c !== PREFER_NOT_CODE && c !== OTHER_CODE
        )
        passed = claimed.length === 0
        if (!passed) detail = `claimed ${claimed.join(',')}`
        break
      }

      case 'duplicate': {
        const other = check.of ? answers[check.of] : undefined
        if (!answer || !other) break
        passed = JSON.stringify(answer) === JSON.stringify(other)
        if (!passed) detail = `disagrees with ${check.of}`
        break
      }

      case 'gibberish': {
        if (!answer || answer.kind !== 'text') break
        passed = !looksLikeGibberish(answer.value)
        if (!passed) detail = 'open text did not read as language'
        break
      }
    }

    out.push({ questionCode: question.code, kind: check.kind, passed, detail })
  }

  return out
}
