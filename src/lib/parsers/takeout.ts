/**
 * Google Takeout "My Activity" parser.
 *
 * Runs in the browser. See docs/architecture.md - archives are never parsed
 * server-side.
 *
 * Takeout writes one JSON array per product, at paths like:
 *   Takeout/My Activity/Search/MyActivity.json
 *   Takeout/My Activity/Gemini Apps/MyActivity.json
 *
 * Entries look roughly like:
 *   {
 *     "header": "Search",
 *     "title": "Searched for congruence testing",
 *     "titleUrl": "https://www.google.com/search?q=congruence+testing",
 *     "time": "2026-07-14T10:30:00.000Z",
 *     "products": ["Search"]
 *   }
 *
 * Takeout also offers an HTML export. We deliberately only accept JSON; the
 * request step tells respondents to choose JSON, and unrecognised files are
 * reported rather than silently skipped.
 */

import { ActivityRecord, SourceKind, recordId } from '../records'

interface TakeoutEntry {
  header?: string
  title?: string
  titleUrl?: string
  time?: string
  products?: string[]
}

/** Localised Takeout uses different prefixes; strip whichever is present. */
const SEARCH_PREFIXES = ['Searched for ', 'Searched ']

function extractQuery(entry: TakeoutEntry): string | null {
  const title = entry.title?.trim()
  if (!title) return null

  for (const prefix of SEARCH_PREFIXES) {
    if (title.startsWith(prefix)) {
      const query = title.slice(prefix.length).trim()
      if (query) return query
    }
  }

  // Fall back to the q= parameter, which survives title-format changes.
  if (entry.titleUrl) {
    try {
      const q = new URL(entry.titleUrl).searchParams.get('q')
      if (q?.trim()) return q.trim()
    } catch {
      // Malformed URL - fall through.
    }
  }

  // "Visited <site>" and similar are navigation, not queries. Skip them.
  return null
}

function extractPrompt(entry: TakeoutEntry): string | null {
  const title = entry.title?.trim()
  if (!title) return null
  const prefix = 'Prompted '
  const text = title.startsWith(prefix) ? title.slice(prefix.length) : title
  return text.trim() || null
}

export function parseTakeoutActivity(
  json: string,
  source: SourceKind
): ActivityRecord[] {
  let entries: unknown
  try {
    entries = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []

  const records: ActivityRecord[] = []

  for (const raw of entries as TakeoutEntry[]) {
    if (!raw || typeof raw !== 'object') continue
    if (!raw.time) continue

    const timestamp = new Date(raw.time).toISOString()
    if (timestamp === 'Invalid Date') continue

    const text =
      source === 'google_search' || source === 'google_ai_mode'
        ? extractQuery(raw)
        : extractPrompt(raw)
    if (!text) continue

    records.push({
      id: recordId(source, timestamp, text),
      source,
      timestamp,
      text,
    })
  }

  return records
}

/**
 * Maps a path inside a Takeout archive to the source it represents.
 *
 * Both formats are accepted. HTML is what Takeout produces by default, so it
 * is what most respondents will hand us however clearly the instructions ask
 * for JSON - and refusing it would cost them another export and another wait.
 */
export function takeoutSourceForPath(path: string): SourceKind | null {
  const lower = path.toLowerCase()
  if (!/myactivity\.(json|html)$/.test(lower)) return null
  if (lower.includes('/search/')) return 'google_search'
  if (lower.includes('/ai mode/') || lower.includes('/ai_mode/')) {
    return 'google_ai_mode'
  }
  if (lower.includes('/gemini')) return 'gemini'
  return null
}

export function isHtmlActivity(path: string): boolean {
  return path.toLowerCase().endsWith('.html')
}

/**
 * Timezone abbreviations Takeout emits. Safari will not reliably parse a date
 * string ending in one, and guessing wrong shifts every timestamp by hours, so
 * we resolve the offset ourselves and only fall back to Date.parse when the
 * abbreviation is unfamiliar.
 */
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0, GMT: 0, EST: -5, EDT: -4, CST: -6, CDT: -5,
  MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8,
  HST: -10, BST: 1, CET: 1, CEST: 2, IST: 5.5, JST: 9, AEST: 10, AEDT: 11,
}

function parseActivityTime(raw: string): string | null {
  const text = raw.trim()
  const match = text.match(/^(.*?)[\s ]+([A-Z]{2,4})$/)

  if (match && match[2] in TZ_OFFSETS) {
    const offset = TZ_OFFSETS[match[2]]
    // Interpret the wall-clock reading as UTC, then subtract the zone offset.
    const asUtc = Date.parse(match[1].replace(/ /g, ' ') + ' UTC')
    if (!Number.isNaN(asUtc)) {
      return new Date(asUtc - offset * 3600_000).toISOString()
    }
  }

  const direct = Date.parse(text.replace(/ /g, ' '))
  return Number.isNaN(direct) ? null : new Date(direct).toISOString()
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (whole, name) => ENTITIES[name] ?? whole)
}

/**
 * Parses the HTML flavour of My Activity.
 *
 * Deliberately not DOMParser: these files run to several megabytes and a full
 * document on a phone is a lot of memory for what is a flat list. We split on
 * the repeated block wrapper and read each block on its own.
 *
 * One block looks like:
 *   <div class="outer-cell ...">
 *     <div class="header-cell ..."><p class="...--title">Search</p></div>
 *     <div class="content-cell ...--body-1">
 *       Searched for <a href="...">query</a><br>Aug 4, 2026, 2:21:50 PM PDT<br>
 *     </div>
 *     ...
 */
export function parseTakeoutHtml(
  html: string,
  source: SourceKind
): ActivityRecord[] {
  const records: ActivityRecord[] = []
  const blocks = html.split('outer-cell')

  for (const block of blocks) {
    const cell = block.match(
      /<div class="content-cell[^"]*mdl-typography--body-1"[^>]*>([\s\S]*?)<\/div>/
    )
    if (!cell) continue
    const body = cell[1]

    // "Visited", "Viewed" and "Used" are navigation and product events, not
    // something the respondent typed.
    if (!/^\s*Searched for\s*</.test(body)) continue

    const anchor = body.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)
    if (!anchor) continue
    const text = decodeEntities(anchor[1].replace(/<[^>]+>/g, '')).trim()
    if (!text) continue

    // The timestamp is the text node between the anchor and the next break.
    const after = body.slice(anchor.index! + anchor[0].length)
    const stamp = after.match(/<br\s*\/?>([^<]+)/)
    if (!stamp) continue
    const timestamp = parseActivityTime(decodeEntities(stamp[1]))
    if (!timestamp) continue

    records.push({
      id: recordId(source, timestamp, text),
      source,
      timestamp,
      text,
    })
  }

  return records
}
