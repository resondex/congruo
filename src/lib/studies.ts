/**
 * Study configuration and redirect safety.
 *
 * A study is one fielding. Its mode decides whether we run the interview or
 * only the capture, and its return allowlist decides where a respondent may be
 * sent afterwards.
 */

import 'server-only'
import type { SourceKind } from './records'
import { db, dbConfigured } from './db'

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
 * Fallback registry, used only when no database is configured so the app is
 * still demonstrable on a fresh checkout. With Supabase present, the `studies`
 * table is the single source of truth - a return-host allowlist that needed a
 * deploy to change would be the wrong shape for a fielding tool.
 */
const FALLBACK_STUDIES: Record<string, Study> = {
  dev: {
    slug: 'dev',
    name: 'Development study',
    mode: 'full_service',
    sources: [
      'google_search',
      'google_ai_mode',
      'google_image_search',
      'google_video_search',
      'google_hotels',
      'google_shopping',
      'google_maps',
      'youtube',
      'youtube_engagement',
      'gemini',
      'chatgpt',
    ],
    returnHosts: ['localhost'],
    respondentParam: 'rid',
    statusParam: 'status',
  },
}

interface StudyRow {
  slug: string
  name: string
  mode: CaptureMode
  sources: string[]
  return_hosts: string[]
  default_return_url: string | null
  respondent_param: string
  status_param: string
  window_from: string | null
  window_to: string | null
}

function fromRow(row: StudyRow): Study {
  return {
    slug: row.slug,
    name: row.name,
    mode: row.mode,
    sources: row.sources as SourceKind[],
    returnHosts: row.return_hosts ?? [],
    defaultReturnUrl: row.default_return_url ?? undefined,
    respondentParam: row.respondent_param,
    statusParam: row.status_param,
    window:
      row.window_from || row.window_to
        ? {
            from: row.window_from ?? undefined,
            to: row.window_to ?? undefined,
          }
        : undefined,
  }
}

export async function getStudy(
  slug: string | undefined
): Promise<Study | null> {
  if (!slug) return null

  if (!dbConfigured()) {
    return FALLBACK_STUDIES[slug] ?? null
  }

  const rows = await db()<StudyRow[]>`
    select slug, name, mode, sources, return_hosts, default_return_url,
           respondent_param, status_param, window_from, window_to
    from studies
    where slug = ${slug}
    limit 1
  `
  return rows.length ? fromRow(rows[0]) : null
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
export async function readCaptureParams(
  search: Record<string, string | string[] | undefined>
): Promise<CaptureParams | { error: string }> {
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v

  const study = await getStudy(first(search.study))
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
