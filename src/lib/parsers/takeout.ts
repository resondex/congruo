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
      source === 'google_search' ? extractQuery(raw) : extractPrompt(raw)
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

/** Maps a path inside a Takeout archive to the source it represents. */
export function takeoutSourceForPath(path: string): SourceKind | null {
  const lower = path.toLowerCase()
  if (!lower.endsWith('myactivity.json')) return null
  if (lower.includes('/search/')) return 'google_search'
  if (lower.includes('/gemini')) return 'gemini'
  return null
}
