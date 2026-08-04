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
 * HTML is Takeout's default and there is no URL parameter to change it, so
 * HTML is the path most respondents take, not a fallback. Both formats parse
 * to the same records; unrecognised files are reported rather than silently
 * skipped.
 */

import {
  ActivityRecord,
  SourceKind,
  classifyAction,
  normaliseText,
  recordId,
} from '../records'

interface TakeoutEntry {
  header?: string
  title?: string
  titleUrl?: string
  time?: string
  products?: string[]
  /** AI Mode only: the generated answer that was shown. */
  safeHtmlItem?: { html?: string }[]
}

/**
 * Takeout writes the action into the title: "Searched for foo", "Visited bar",
 * "Watched baz". We split the verb off the subject and keep both - no entry is
 * discarded here, because deciding which actions matter is a study setting,
 * not a parsing detail.
 *
 * Longest first, and several of these are more than one word. Getting that
 * wrong is silent: "Viewed image from X" against a one-word "Viewed " prefix
 * leaves "image from X" as the subject, which differs from what the HTML
 * export yields for the same event and quietly desynchronises the two formats.
 */
const TITLE_VERBS = [
  'Ran internet speed test',
  'Viewed image from ',
  'Searched for ',
  'Searched with ',
  'Viewed job ',
  'Visited ',
  'Searched ',
  'Watched ',
  'Defined ',
  'Viewed ',
  'Used ',
]

function splitTitle(title: string): { phrase: string; text: string } {
  for (const verb of TITLE_VERBS) {
    if (title.startsWith(verb)) {
      return { phrase: verb.trim(), text: title.slice(verb.length).trim() }
    }
  }
  return { phrase: '', text: title.trim() }
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

    const title = normaliseText(raw.title ?? '')
    if (!title) continue
    const { phrase, text } = splitTitle(title)
    if (!text) continue

    records.push({
      id: recordId(source, timestamp, text),
      source,
      timestamp,
      text,
      action: classifyAction(phrase || title),
      actionPhrase: phrase || undefined,
      url: raw.titleUrl,
      ...extractAnswer(raw.safeHtmlItem?.[0]?.html ?? ''),
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
/**
 * Folder name inside "My Activity" to the source it represents.
 *
 * Deliberately excluded, and worth keeping excluded:
 *   Gmail   - searches inside a private mailbox, not public behaviour
 *   Help    - Google support queries
 *   Lens    - image queries, no usable text
 *   Drive, Ads, Analytics, Developers, Discover, Takeout - not behaviour
 */
const FOLDER_SOURCES: [RegExp, SourceKind][] = [
  [/\/image search\//, 'google_image_search'],
  [/\/video search\//, 'google_video_search'],
  [/\/ai[ _]mode\//, 'google_ai_mode'],
  [/\/hotels\//, 'google_hotels'],
  [/\/shopping\//, 'google_shopping'],
  [/\/gemini[^/]*\//, 'gemini'],
  // Last: "/search/" would otherwise swallow "/image search/".
  [/\/search\//, 'google_search'],
]

export function takeoutSourceForPath(path: string): SourceKind | null {
  const lower = path.toLowerCase()
  if (!/myactivity\.(json|html)$/.test(lower)) return null
  for (const [pattern, source] of FOLDER_SOURCES) {
    if (pattern.test(lower)) return source
  }
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

/**
 * Pulls an AI Mode answer out of its markup.
 *
 * Both exports carry the same content: the JSON in `safeHtmlItem[0].html`, the
 * HTML inline after the timestamp. Block-level tags become line breaks so a
 * list does not collapse into one run-on sentence when the tags are stripped.
 */
export function extractAnswer(markup: string): {
  answer?: string
  citations?: string[]
} {
  if (!markup.trim()) return {}

  const citations: string[] = []
  for (const m of markup.matchAll(/href="([^"]+)"/g)) {
    const url = decodeEntities(m[1])
    if (/^https?:/i.test(url) && !citations.includes(url)) citations.push(url)
  }

  const answer = decodeEntities(
    markup
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/pre)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

  return {
    answer: answer || undefined,
    citations: citations.length ? citations : undefined,
  }
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
    // Not a non-greedy match up to </div>: AI Mode answers contain their own
    // <div> elements, so the first closing tag belongs to the answer rather
    // than the cell, and stopping there truncates it. Run to the next sibling
    // cell instead, or to the end of the block.
    const open = block.match(
      /<div class="content-cell[^"]*mdl-typography--body-1"[^>]*>/
    )
    if (!open) continue
    const from = open.index! + open[0].length
    const rest = block.slice(from)
    const nextCell = rest.search(/<div class="content-cell/)
    const body = nextCell === -1 ? rest : rest.slice(0, nextCell)

    // Two shapes, and only one of them has a link:
    //   Visited      <a href="url">title</a><br>timestamp<br>
    //   Searched for query<br>timestamp<br>
    // Hotels is almost entirely the second kind, so requiring an anchor
    // silently discarded every search in that folder.
    const breakAt = body.search(/<br\s*\/?>/i)
    if (breakAt === -1) continue
    const head = body.slice(0, breakAt)
    const tail = body.slice(breakAt)

    // Most blocks put the date immediately after the first break, but some
    // carry an extra descriptive line first ("Including topics: ..."), so take
    // the first segment that actually parses as a date rather than assuming a
    // position. Assuming cost 20 records in a real archive.
    // AI Mode puts the generated answer inline, after the timestamp:
    //   Searched for <a>query</a><br>timestamp<br><p>answer...</p>
    // So track where the date actually landed rather than assuming a position,
    // and treat whatever follows it as the answer. Empty for every other
    // product.
    let timestamp: string | null = null
    let answerMarkup = ''
    const segments = tail.split(/(<br\s*\/?>)/i)
    let consumed = 0
    for (const segment of segments) {
      consumed += segment.length
      const plain = decodeEntities(segment.replace(/<[^>]+>/g, '')).trim()
      if (!plain) continue
      const parsed = parseActivityTime(plain)
      if (parsed) {
        timestamp = parsed
        answerMarkup = tail.slice(consumed)
        break
      }
    }
    if (!timestamp) continue

    const anchor = head.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)

    let phrase: string
    let text: string
    let url: string | undefined

    if (anchor) {
      phrase = decodeEntities(head.slice(0, anchor.index!).replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
      text = normaliseText(decodeEntities(anchor[1].replace(/<[^>]+>/g, '')))
      url = anchor[0].match(/href="([^"]*)"/)?.[1]
    } else {
      // Verb and subject are one run of text; split on the verb rather than
      // by length, which would truncate a long query.
      const plain = normaliseText(decodeEntities(head.replace(/<[^>]+>/g, '')))
      const split = splitTitle(plain)
      phrase = split.phrase
      text = split.text
    }

    if (!text) continue

    // Every action is extracted and tagged. Which ones a study keeps is
    // policy, applied later - "Watched" is noise for a search study and the
    // entire signal for a media one.
    records.push({
      id: recordId(source, timestamp, text),
      source,
      timestamp,
      text,
      action: classifyAction(phrase || text),
      actionPhrase: phrase || undefined,
      url,
      ...extractAnswer(answerMarkup),
    })
  }

  return records
}
