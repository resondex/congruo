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
  normaliseAnswer,
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
 * One row per Google product.
 *
 * Everything that differs between products lives here, because the format does
 * not differ at all: every product writes the same JSON entry shape and the
 * same HTML block shape, and only the reading of them changes. Six parsers
 * would duplicate the container, timestamp and anchor handling and let the
 * copies drift, which is the failure this table exists to prevent - drift
 * between two things that should be identical is most of what a parser audit
 * ever finds.
 *
 * Adding a product is adding a row. Anything not listed here is read by no
 * rule and counted by no counter.
 *
 * Order matters: `folder` patterns are tried in sequence, so "/search/" must
 * come last or it swallows "/image search/".
 */
interface Product {
  /** Path fragment inside "My Activity", lowercased. */
  folder: RegExp
  source: SourceKind
  /** Verbs this product uses beyond the shared list. */
  verbs?: string[]
  /**
   * A title with no verb is the subject itself.
   *
   * Maps writes a viewed place as its bare name or address - "Hilton Garden
   * Inn", "3208 W 51st Ave" - with the place in titleUrl and no verb anywhere.
   * Everywhere else a verbless title is Google's own notice and dropping it is
   * the point, so this cannot be the default.
   */
  bareTitleIsSubject?: boolean
  /**
   * The HTML after the timestamp is a generated answer.
   *
   * The HTML export has no field for it - the answer is simply whatever
   * follows the date - so the rule has to come from the product. Applying it
   * everywhere made a YouTube channel subtitle parse as a six-word "AI
   * answer". The JSON export names the field and needs no such guess.
   */
  carriesAnswer?: boolean
  /**
   * Verbs that move a record to a second source.
   *
   * YouTube watching and YouTube engagement arrive in one file and cannot be
   * told apart by path, but they are not equally sensitive: a study measuring
   * search behaviour should be able to ask for what someone watched without
   * also collecting what they liked.
   */
  splitBy?: { verbs: string[]; into: SourceKind }
}

const PRODUCTS: Product[] = [
  { folder: /\/image search\//, source: 'google_image_search' },
  { folder: /\/video search\//, source: 'google_video_search' },
  { folder: /\/ai[ _]mode\//, source: 'google_ai_mode', carriesAnswer: true },
  { folder: /\/hotels\//, source: 'google_hotels' },
  { folder: /\/shopping\//, source: 'google_shopping' },
  { folder: /\/gemini[^/]*\//, source: 'gemini', carriesAnswer: true },
  {
    // "YouTube Music" is a different product and is not matched here.
    folder: /\/youtube\//,
    source: 'youtube',
    verbs: ['Subscribed to ', 'Commented on ', 'Disliked ', 'Joined ', 'Liked '],
    splitBy: {
      verbs: ['Subscribed to', 'Commented on', 'Disliked', 'Joined', 'Shared', 'Saved', 'Liked'],
      into: 'youtube_engagement',
    },
  },
  {
    folder: /\/maps\//,
    source: 'google_maps',
    verbs: ['Directions to '],
    bareTitleIsSubject: true,
  },
  { folder: /\/search\//, source: 'google_search' },
]

const BY_SOURCE = new Map(PRODUCTS.map((p) => [p.source, p]))

/** The product a record belongs to, including one reached by splitBy. */
function productFor(source: SourceKind): Product | undefined {
  return (
    BY_SOURCE.get(source) ??
    PRODUCTS.find((p) => p.splitBy?.into === source)
  )
}

/**
 * Verbs shared by every product, plus whatever the products add.
 *
 * Longest first, and several are more than one word. Getting that order wrong
 * is silent: "Viewed image from X" against a one-word "Viewed " prefix leaves
 * "image from X" as the subject, which differs from what the HTML export
 * yields for the same event and quietly desynchronises the two formats.
 *
 * One list rather than one per product. A verb missing where it was needed
 * drops records, and the cost of a verb being recognised somewhere it never
 * appears is nothing.
 */
const SHARED_VERBS = [
  'Viewed image from ',
  'Searched for ',
  'Searched with ',
  'Viewed job ',
  'Visited ',
  'Searched ',
  'Watched ',
  'Defined ',
  'Shared ',
  'Viewed ',
  'Saved ',
  'Used ',
]

const TITLE_VERBS = [
  ...new Set([...SHARED_VERBS, ...PRODUCTS.flatMap((p) => p.verbs ?? [])]),
].sort((a, b) => b.length - a.length)

/**
 * Whole titles that record that a product was opened, not anything done in it.
 *
 * Takeout files these alongside real activity and they carry no measurable
 * subject: "Used Search" yields the word "Search". Left in, a real archive
 * delivered 87 of them to a client as behaviour. Matched as whole titles
 * rather than as verbs, because that is what they are - a verb list is for
 * splitting an action off its object, and these have no object.
 */
const BOILERPLATE = [
  /^\d+ notifications?$/i,
  /^used (search|maps|google maps|lens|assistant|gemini|chrome|youtube)$/i,
  /^explored on google maps$/i,
  /^ran internet speed test$/i,
]

const isBoilerplate = (title: string) => BOILERPLATE.some((p) => p.test(title))

function splitTitle(title: string): { phrase: string; text: string } | null {
  for (const verb of TITLE_VERBS) {
    if (title.startsWith(verb)) {
      return { phrase: verb.trim(), text: title.slice(verb.length).trim() }
    }
  }
  return null
}

/** A verbless title, where the source says that is the subject. */
function bareTitle(
  source: SourceKind,
  title: string
): { phrase: string; text: string } | null {
  return productFor(source)?.bareTitleIsSubject
    ? { phrase: 'Viewed', text: title }
    : null
}

function refineSource(source: SourceKind, phrase: string): SourceKind {
  const split = BY_SOURCE.get(source)?.splitBy
  return split?.verbs.includes(phrase) ? split.into : source
}

/**
 * Whole seconds.
 *
 * The JSON export carries milliseconds and the HTML export cannot - it prints
 * "Aug 4, 2026, 2:21:50 PM PDT". Keeping the extra precision means the same
 * event from the same account is a different record depending on which format
 * the respondent happened to download, which breaks deduplication between them
 * and makes the two exports impossible to reconcile. Nothing in this instrument
 * measures anything at sub-second resolution.
 */
function toWholeSecond(iso: string): string {
  return iso.replace(/\.\d{1,3}Z$/, '.000Z')
}

/**
 * What one file yielded, and what it cost.
 *
 * The counts are not diagnostics for us - they are the difference between a
 * parser that quietly drops a tenth of someone's archive and one that says so.
 */
export interface ParseResult {
  records: ActivityRecord[]
  /** Titles starting with no verb we know: not activity, or a format change. */
  unrecognised: number
  /** Recognised acts with no subject to measure, e.g. an internet speed test. */
  contentless: number
  /** HTML blocks carrying no line that parses as a date. */
  undated: number
}

const empty = (): ParseResult => ({
  records: [],
  unrecognised: 0,
  contentless: 0,
  undated: 0,
})

export function parseTakeoutActivity(
  json: string,
  source: SourceKind
): ParseResult {
  let entries: unknown
  try {
    entries = JSON.parse(json)
  } catch {
    return empty()
  }
  if (!Array.isArray(entries)) return empty()

  const out = empty()

  for (const raw of entries as TakeoutEntry[]) {
    if (!raw || typeof raw !== 'object') continue
    if (!raw.time) continue

    const timestamp = toWholeSecond(new Date(raw.time).toISOString())
    if (timestamp === 'Invalid Date') continue

    const title = normaliseText(raw.title ?? '')
    if (!title) continue
    if (isBoilerplate(title)) {
      out.contentless++
      continue
    }

    const split = splitTitle(title) ?? bareTitle(source, title)
    if (!split) {
      out.unrecognised++
      continue
    }
    if (!split.text) {
      out.contentless++
      continue
    }
    const { phrase, text } = split
    const actual = refineSource(source, phrase)

    out.records.push({
      id: recordId(actual, timestamp, text),
      source: actual,
      timestamp,
      text,
      action: classifyAction(phrase || title),
      actionPhrase: phrase || undefined,
      url: raw.titleUrl,
      ...extractAnswer(raw.safeHtmlItem?.[0]?.html ?? ''),
    })
  }

  return out
}

/**
 * Maps a path inside a Takeout archive to the source it represents.
 *
 * Both formats are accepted. HTML is what Takeout produces by default, so it
 * is what most respondents will hand us however clearly the instructions ask
 * for JSON - and refusing it would cost them another export and another wait.
 */
/**
 * Folders deliberately not read, and worth keeping that way:
 *   Gmail   - searches inside a private mailbox, not public behaviour
 *   Help    - Google support queries
 *   Lens    - image queries, no usable text
 *   Drive, Ads, Analytics, Developers, Discover, Takeout - not behaviour
 *
 * Everything read is a row in PRODUCTS. A folder in neither list is silently
 * ignored, so add it to one of them rather than leaving it to fall through.
 */

export function takeoutSourceForPath(path: string): SourceKind | null {
  const lower = path.toLowerCase()
  if (!/myactivity\.(json|html)$/.test(lower)) return null
  for (const product of PRODUCTS) {
    if (product.folder.test(lower)) return product.source
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

const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i

/**
 * Whether a line is plausibly a date at all.
 *
 * Date.parse is permissive to the point of being dangerous on arbitrary text.
 * A YouTube block lists the channel before the date, and a channel called
 * "Last War: Survival Server #1146" parsed as the year 1146 - so that record
 * took a timestamp 879 years off and the real date, two lines below, was never
 * reached. A wrong date is worse than a missing one: nothing about it looks
 * like a failure.
 *
 * Requiring a year, a clock time, and either a month name or a numeric date
 * covers what Takeout emits both in locales that spell months out and in those
 * that write dates numerically, while rejecting prose that merely contains a
 * number.
 */
function looksLikeDate(text: string): boolean {
  if (text.length > 64) return false
  if (!/\b\d{4}\b/.test(text)) return false
  if (!/\d{1,2}:\d{2}/.test(text)) return false
  return MONTH.test(text) || /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(text)
}

function parseActivityTime(raw: string): string | null {
  const text = raw.trim()
  if (!looksLikeDate(text)) return null
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
/**
 * Google's own markers inside an answer, entity-encoded in the source so they
 * survive tag stripping and reappear as literal text once entities are decoded.
 *
 * Only these names are removed, and only the marker - the words between them
 * are answer text the respondent was shown. A blanket strip of anything in
 * angle brackets is not available here: one real answer was about writing HTML
 * and its code examples are legitimately full of them.
 */
const SCAFFOLDING = /<\/?(FollowUp|Query|Sources?)>/gi

function stripScaffolding(text: string): string {
  return text.replace(SCAFFOLDING, ' ')
}

/**
 * Splits an answer into the blocks it was written in, each with the citations
 * linked inside it.
 *
 * The flat citation list says an answer cited four sources; it does not say
 * which claim each one backed, or - more to the point - how much of the answer
 * cited nothing at all. On a real archive that gap is the whole story: 22
 * citations across roughly 440 blocks, so the overwhelming majority of what an
 * AI asserted was unattributed. A client asking which sources an assistant
 * repeats cannot answer it from a list that has already thrown the positions
 * away.
 *
 * A block - paragraph, list item, heading - is the unit because it is the unit
 * the answer was composed in, and because a citation sits inside exactly one
 * of them. Sentence splitting would be finer and wrong: the anchors straddle
 * sentence boundaries often enough that the attribution would be a guess.
 */
export interface AnswerPassage {
  text: string
  /** Citations anchored inside this passage, in the order they appear. */
  citations: { url: string; text: string }[]
}

const BLOCK_BOUNDARY =
  /<\/?(?:p|li|h[1-6]|div|ul|ol|pre|blockquote|tr|table|section)\b[^>]*>|<br\s*\/?>/gi

export function extractPassages(markup: string): AnswerPassage[] {
  const passages: AnswerPassage[] = []

  for (const chunk of markup.replace(BLOCK_BOUNDARY, '\u0000').split('\u0000')) {
    if (!chunk.trim()) continue

    const citations: { url: string; text: string }[] = []
    for (const m of chunk.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = decodeEntities(m[1])
      if (!/^https?:/i.test(url)) continue
      citations.push({
        url,
        text: normaliseText(decodeEntities(m[2].replace(/<[^>]+>/g, ' '))),
      })
    }

    const text = normaliseText(
      stripScaffolding(decodeEntities(chunk.replace(/<[^>]+>/g, ' ')))
    )
    if (!text && !citations.length) continue
    passages.push({ text, citations })
  }

  return passages
}

export function extractAnswer(markup: string): {
  answer?: string
  citations?: string[]
  passages?: AnswerPassage[]
} {
  if (!markup.trim()) return {}

  const citations: string[] = []
  for (const m of markup.matchAll(/href="([^"]+)"/g)) {
    const url = decodeEntities(m[1])
    if (/^https?:/i.test(url) && !citations.includes(url)) citations.push(url)
  }

  const answer = normaliseAnswer(
    stripScaffolding(
      decodeEntities(
        markup
          .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/pre)\b[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
      )
    )
  )

  const passages = extractPassages(markup)

  return {
    answer: answer || undefined,
    citations: citations.length ? citations : undefined,
    passages: passages.length ? passages : undefined,
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
): ParseResult {
  const out = empty()
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
    if (!timestamp) {
      out.undated++
      continue
    }

    const anchor = head.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)

    let phrase: string
    let text: string
    let url: string | undefined

    if (anchor) {
      phrase = decodeEntities(head.slice(0, anchor.index!).replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
      // The whole cell, verb and link together, can still be a usage notice.
      const whole = normaliseText(decodeEntities(head.replace(/<[^>]+>/g, '')))
      if (isBoilerplate(whole)) {
        out.contentless++
        continue
      }
      text = normaliseText(decodeEntities(anchor[1].replace(/<[^>]+>/g, '')))
      url = anchor[0].match(/href="([^"]*)"/)?.[1]
      // Maps links the place with no verb in front of it. The JSON export of
      // the same row has no verb either and is read as a view, so say so here
      // too rather than letting the two formats disagree on the action.
      if (!phrase && productFor(source)?.bareTitleIsSubject) phrase = 'Viewed'
    } else {
      // Verb and subject are one run of text; split on the verb rather than
      // by length, which would truncate a long query.
      //
      // An unrecognised verb here is how Google's own notices arrive - they
      // have no link, so they never take the anchored branch above. Anchored
      // rows are kept whatever their verb: a link means there was a thing they
      // acted on, which is the definition of an activity.
      const plain = normaliseText(decodeEntities(head.replace(/<[^>]+>/g, '')))
      if (isBoilerplate(plain)) {
        out.contentless++
        continue
      }
      const split = splitTitle(plain) ?? bareTitle(source, plain)
      if (!split) {
        out.unrecognised++
        continue
      }
      phrase = split.phrase
      text = split.text
    }

    if (!text) {
      out.contentless++
      continue
    }

    // Every action is extracted and tagged. Which ones a study keeps is
    // policy, applied later - "Watched" is noise for a search study and the
    // entire signal for a media one.
    const actual = refineSource(source, phrase)

    out.records.push({
      id: recordId(actual, timestamp, text),
      source: actual,
      timestamp,
      text,
      action: classifyAction(phrase || text),
      actionPhrase: phrase || undefined,
      url,
      ...(productFor(source)?.carriesAnswer ? extractAnswer(answerMarkup) : {}),
    })
  }

  return out
}
