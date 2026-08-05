/**
 * The single record shape every source is normalised into.
 *
 * One record is one thing the respondent did: a search they ran, a prompt they
 * sent. Records are created in the browser and never leave it unless the
 * respondent releases them.
 */

export type SourceKind =
  | 'google_search'
  | 'google_ai_mode'
  | 'google_image_search'
  | 'google_video_search'
  | 'google_hotels'
  | 'google_shopping'
  | 'google_maps'
  | 'youtube'
  | 'youtube_engagement'
  | 'gemini'
  | 'chatgpt'
  | 'claude'
  | 'perplexity'

export const SOURCE_LABELS: Record<SourceKind, string> = {
  google_search: 'Google search',
  // Google's AI-mediated search results. A separate Takeout product from
  // Search, and squarely the behaviour this instrument exists to measure.
  google_ai_mode: 'Google AI Mode',
  google_image_search: 'Google image search',
  google_video_search: 'Google video search',
  google_hotels: 'Google hotels',
  google_shopping: 'Google shopping',
  google_maps: 'Google Maps',
  youtube: 'YouTube videos',
  // Split from watching on purpose. "Watched a video" and "disliked this
  // political channel" are not the same disclosure, and a study buying search
  // behaviour should not receive someone's stated preferences as a by-product
  // of them ticking one box.
  youtube_engagement: 'YouTube likes and subscriptions',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
}

/**
 * How sources are presented for consent.
 *
 * Records are stored per source, but eight checkboxes for what a respondent
 * thinks of as "my Google history" is false precision - and the six Google
 * products below arrive in a single Takeout export, so choosing between them
 * at consent decides nothing about what gets downloaded. The group is the
 * decision; `includes` is what that decision covers, listed rather than
 * summarised, and item-by-item redaction happens at review.
 *
 * Gemini is deliberately not inside the Google group. It comes in the same
 * export, but a conversation is a different kind of disclosure from a search,
 * and burying it under "search activity" would be the sort of rolling-up that
 * costs someone a decision they would have made differently.
 */
export interface SourceGroup {
  id: string
  label: string
  sources: SourceKind[]
  /** Plain-language list of what the group covers. */
  includes: string[]
  /** Where the export is requested. Groups sharing one are requested once. */
  exportUrl: string
  /** Named in the request step when several groups share an export. */
  exportName: string
}

const TAKEOUT =
  // Takeout accepts a product list in the path and preselects exactly those.
  // That removes steps and, more usefully, removes any chance of ticking
  // "Access log activity" by mistake - it is never selected to begin with.
  'https://takeout.google.com/settings/takeout/custom/my_activity'

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'google_activity',
    label: 'Google search activity',
    sources: [
      'google_search',
      'google_ai_mode',
      'google_image_search',
      'google_video_search',
      'google_hotels',
      'google_shopping',
    ],
    includes: [
      'What you searched for on Google',
      'AI Mode answers you were shown, and the sources they cited',
      'Image and video searches',
      'Shopping and hotel searches',
    ],
    exportUrl: TAKEOUT,
    exportName: 'Google',
  },
  {
    id: 'google_maps',
    label: 'Google Maps activity',
    sources: ['google_maps'],
    includes: [
      'Places you looked up and directions you asked for',
      'This is a record of where you went, so it is asked for separately',
    ],
    exportUrl: TAKEOUT,
    exportName: 'Google',
  },
  {
    id: 'youtube',
    label: 'YouTube activity',
    sources: ['youtube', 'youtube_engagement'],
    includes: [
      'Videos you watched, and what you searched for on YouTube',
      'Channels you subscribed to, and videos you liked or disliked',
    ],
    exportUrl: TAKEOUT,
    exportName: 'Google',
  },
  {
    id: 'gemini',
    label: 'Gemini conversations',
    sources: ['gemini'],
    includes: ['What you asked Gemini'],
    exportUrl: TAKEOUT,
    exportName: 'Google',
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT conversations',
    sources: ['chatgpt'],
    includes: ['What you asked ChatGPT, and what it replied'],
    exportUrl: 'https://chatgpt.com/#settings/DataControls',
    exportName: 'ChatGPT',
  },
  {
    id: 'claude',
    label: 'Claude conversations',
    sources: ['claude'],
    includes: ['What you asked Claude, and what it replied'],
    exportUrl: 'https://claude.ai/settings/data-privacy-controls',
    exportName: 'Claude',
  },
  {
    id: 'perplexity',
    label: 'Perplexity searches',
    sources: ['perplexity'],
    includes: ['What you asked Perplexity, and the sources it cited'],
    exportUrl: 'https://www.perplexity.ai/settings/account',
    exportName: 'Perplexity',
  },
]

/**
 * The groups a study actually uses, each narrowed to the sources that study
 * asks for. A study that wants search but not shopping gets a Google group
 * whose list says so, rather than one that promises more than it collects.
 */
export function groupsFor(sources: SourceKind[]): SourceGroup[] {
  const wanted = new Set(sources)
  return SOURCE_GROUPS.map((group) => ({
    ...group,
    sources: group.sources.filter((s) => wanted.has(s)),
  })).filter((group) => group.sources.length > 0)
}

/**
 * What the respondent did, normalised from Takeout's phrasing.
 *
 * Extraction records the action; policy decides which actions a study keeps.
 * Keeping those separate is the point: "Watched" is worthless for a search
 * study and is the whole signal for a media one, and that should be a study
 * setting rather than something buried in a parser.
 */
export type ActionKind =
  | 'searched'
  | 'watched'
  | 'viewed'
  | 'visited'
  | 'used'
  | 'subscribed'
  | 'liked'
  | 'disliked'
  | 'navigated'
  | 'shared'
  | 'other'

const ACTION_PATTERNS: [RegExp, ActionKind][] = [
  [/^searched (for|with)\b/i, 'searched'],
  [/^watched\b/i, 'watched'],
  [/^viewed\b/i, 'viewed'],
  [/^visited\b/i, 'visited'],
  [/^used\b/i, 'used'],
  [/^subscribed\b/i, 'subscribed'],
  [/^liked\b/i, 'liked'],
  [/^disliked\b/i, 'disliked'],
  // Maps. Asking for directions is a stated intention to go somewhere, which
  // is a different claim from having looked a place up.
  [/^directions to\b/i, 'navigated'],
  [/^shared\b/i, 'shared'],
]

export function classifyAction(phrase: string): ActionKind {
  const text = phrase.trim()
  for (const [pattern, kind] of ACTION_PATTERNS) {
    if (pattern.test(text)) return kind
  }
  return 'other'
}

/**
 * Canonical form for extracted text.
 *
 * The HTML and JSON exports of the same event encode it slightly differently -
 * a non-breaking space in one, a narrow no-break space in the other, composed
 * versus decomposed accents. Without this the same search from two formats
 * looks like two different searches, which breaks deduplication and makes the
 * two exports impossible to reconcile.
 */
export function normaliseText(text: string): string {
  return text
    .normalize('NFC')
    // Every unicode space variant, including U+00A0 and U+202F, becomes plain.
    .replace(/[\s  -​  　]+/g, ' ')
    .trim()
}

/**
 * Canonical form for an AI answer.
 *
 * Same folding as normaliseText, except line breaks survive: an answer is
 * paragraphs, headings and bullets, and flattening it to one line destroys the
 * structure a reader needs to judge what they are releasing.
 */
export function normaliseAnswer(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

export interface ActivityRecord {
  /** Stable within a session; used for dedup and for review-list keys. */
  id: string
  source: SourceKind
  /** ISO 8601. Records with no usable timestamp are dropped by the parsers. */
  timestamp: string
  /** What the respondent typed, watched, or opened. */
  text: string
  /** What they did with it. Extraction records; policy filters. */
  action: ActionKind
  /** Takeout's own wording, kept so an unexpected verb is debuggable. */
  actionPhrase?: string
  /**
   * For a search this is redundant with the text; for a visit or a watch it
   * IS the content. Never surfaced to the respondent as-is - it carries
   * tracking parameters - but retained so policy can use it.
   */
  url?: string
  /** Conversation title or similar. Never required. */
  context?: string
  /**
   * The AI-generated answer the respondent was shown, as plain text.
   *
   * Only ever populated for AI-mediated search, where the answer IS the search
   * result - a page served publicly in response to a query. That is a
   * different thing from the other half of a private conversation, which is
   * why assistant turns are excluded from the ChatGPT parser and this is not.
   */
  answer?: string
  /** Sources the AI cited in that answer, in the order shown. */
  citations?: string[]
}

/**
 * A record plus the respondent's decision about it. `withheld` records are
 * excluded from the release payload; they exist only so the review UI can show
 * what was held back and the receipt can count it.
 */
export interface ReviewedRecord extends ActivityRecord {
  withheld: boolean
  /**
   * Set when the respondent keeps the query but holds back the AI answer.
   *
   * "I searched for this" and "here is everything the AI told me about it" are
   * different disclosures - the second can be several hundred words about a
   * health worry or a legal problem - so they are decided separately.
   */
  withheldAnswer?: boolean
}

/**
 * FNV-1a. Not a security hash - it only has to be stable and cheap so the
 * review list has sensible keys. Identity is decided on the full tuple in
 * normalise(), never on this hash - see the note there.
 */
export function recordId(
  source: SourceKind,
  timestamp: string,
  text: string
): string {
  let h = 0x811c9dc5
  const input = `${source}\0${timestamp}\0${text}`
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${source}_${h.toString(16).padStart(8, '0')}`
}

/**
 * Drops records outside the study window and removes exact repeats.
 *
 * A repeat is the same source, timestamp AND text. Google records some events
 * several times over - one query appears eighteen times at the same second in
 * a real archive - and collapsing those is right.
 *
 * Identity is the whole tuple, never the id. The id is a 32-bit hash, which
 * collides often enough across a few thousand records to matter, and
 * deduplicating on it would silently discard a respondent's record. Losing
 * someone's data without telling them is the one failure this product cannot
 * have.
 */
export interface NormaliseResult {
  records: ActivityRecord[]
  /** Exact repeats of a record already kept. */
  duplicates: number
  /** Dropped for falling outside the study's date range. */
  outsideWindow: number
}

export function normalise(
  records: ActivityRecord[],
  window?: { from?: Date; to?: Date }
): NormaliseResult {
  const seen = new Set<string>()
  const usedIds = new Set<string>()
  const out: ActivityRecord[] = []
  let duplicates = 0
  let outsideWindow = 0

  for (const record of records) {
    const key = `${record.source}\0${record.timestamp}\0${record.text}`
    if (seen.has(key)) {
      duplicates++
      continue
    }

    // Counted apart from duplicates. Collapsing the two would make a study
    // whose window excluded most of an archive look identical to one whose
    // respondent repeated themselves, and only one of those is a reason to go
    // back and widen the ask.
    if (window) {
      const at = new Date(record.timestamp).getTime()
      if (
        Number.isNaN(at) ||
        (window.from && at < window.from.getTime()) ||
        (window.to && at > window.to.getTime())
      ) {
        outsideWindow++
        continue
      }
    }

    seen.add(key)

    // Keep list keys unique even when two distinct records hash alike.
    let id = record.id
    for (let n = 2; usedIds.has(id); n++) id = `${record.id}_${n}`
    usedIds.add(id)

    out.push(id === record.id ? record : { ...record, id })
  }

  return {
    records: out.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    duplicates,
    outsideWindow,
  }
}
