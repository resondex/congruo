/**
 * Study configuration and redirect safety.
 *
 * A study is one fielding. Its mode decides whether we run the interview or
 * only the capture, and its return allowlist decides where a respondent may be
 * sent afterwards.
 */

import type { SourceKind } from './records'

export type CaptureMode = 'full_service' | 'append'

/**
 * What we tell the referring platform when we hand the respondent back.
 *
 * `declined` must stay distinct from `error`. In append mode the client holds
 * the survey data, so telling them which respondents chose not to release is
 * the only way they can measure donation-selection bias on their own file.
 * Collapsing the two removes that from the product without anyone noticing.
 */
export type ReturnStatus = 'complete' | 'declined' | 'partial' | 'error'

export interface Study {
  slug: string
  name: string
  mode: CaptureMode
  sources: SourceKind[]

  /**
   * Hosts a respondent may be redirected back to. Return URLs arrive in the
   * query string, so without this an attacker could use a live study as an
   * open redirect.
   */
  returnHosts: string[]
  /** Used when the caller passes no return URL of its own. */
  defaultReturnUrl?: string

  /** Query parameter names the referring platform expects on the way back. */
  respondentParam: string
  statusParam: string

  /** Records outside this window are dropped during parsing. */
  window?: { from?: string; to?: string }
}

/**
 * TODO: move to the `studies` table once Supabase is wired. Keeping the
 * allowlist in code means a client's return URL cannot be changed without a
 * deploy, which is the wrong trade long term but the safe one today.
 */
const STUDIES: Record<string, Study> = {
  dev: {
    slug: 'dev',
    name: 'Development study',
    mode: 'full_service',
    sources: ['google_search', 'chatgpt'],
    returnHosts: ['localhost'],
    respondentParam: 'rid',
    statusParam: 'status',
  },
}

export function getStudy(slug: string | undefined): Study | null {
  if (!slug) return null
  return STUDIES[slug] ?? null
}

/** Exact host match. Subdomain wildcards are deliberately not supported. */
export function isAllowedReturn(study: Study, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return false
  }
  return study.returnHosts.includes(parsed.hostname)
}

/**
 * Resolves where to send the respondent next. Returns null when the caller
 * supplied a return URL we do not trust, so the caller can fail loudly rather
 * than redirecting somewhere unexpected.
 */
export function resolveReturnUrl(
  study: Study,
  requested: string | undefined
): string | null {
  if (requested) {
    return isAllowedReturn(study, requested) ? requested : null
  }
  return study.defaultReturnUrl ?? null
}

export function buildReturnUrl(
  study: Study,
  base: string,
  respondentId: string,
  status: ReturnStatus
): string {
  const url = new URL(base)
  url.searchParams.set(study.respondentParam, respondentId)
  url.searchParams.set(study.statusParam, status)
  return url.toString()
}

export interface CaptureParams {
  study: Study
  respondentId: string
  returnUrl: string | null
}

/**
 * Validates the query string a referring platform sends us. In append mode a
 * respondent id is required, because without it the records we collect cannot
 * be joined to anything and the fielding is worthless.
 */
export function readCaptureParams(
  search: Record<string, string | string[] | undefined>
): CaptureParams | { error: string } {
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v

  const study = getStudy(first(search.study))
  if (!study) return { error: 'Unknown study.' }

  const respondentId = first(search.rid)?.trim()
  if (study.mode === 'append' && !respondentId) {
    return { error: 'This link is missing a respondent id.' }
  }

  const requested = first(search.return)
  const returnUrl = resolveReturnUrl(study, requested)
  if (requested && !returnUrl) {
    return { error: 'That return address is not permitted for this study.' }
  }

  return { study, respondentId: respondentId ?? '', returnUrl }
}
