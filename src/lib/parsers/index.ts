/**
 * Archive intake. Browser only.
 *
 * Takes the file the respondent picked, works out what it is, and returns
 * normalised records plus a report of what was read and what was ignored.
 *
 * The report matters: a respondent who hands over an archive and is told
 * "0 records" needs to know whether that means nothing was found or the file
 * was the wrong shape.
 */

import { unzip, strFromU8 } from 'fflate'
import { ActivityRecord, normalise, type SourceKind } from '../records'
import {
  isHtmlActivity,
  parseTakeoutActivity,
  parseTakeoutHtml,
  takeoutSourceForPath,
  type ParseResult,
} from './takeout'
import { parseChatGPTExport } from './chatgpt'

export interface IntakeReport {
  records: ActivityRecord[]
  /** Archive members we recognised and parsed. */
  read: string[]
  /** Archive members we recognised but that yielded nothing. */
  empty: string[]
  /**
   * Entries whose title began with no verb we know.
   *
   * Normally these are Google's own notices, which it files alongside real
   * activity. A sharp rise means Takeout changed its wording and we are
   * dropping real behaviour - which is exactly the failure that would
   * otherwise look like a quiet month.
   */
  unrecognised: number
  /** Recognised acts with no subject to measure, e.g. an internet speed test. */
  contentless: number
  /** HTML blocks carrying no line that parses as a date. */
  undated: number
  /** Records removed as exact repeats of one already kept. */
  duplicates: number
  /** Records dropped for falling outside the study's date range. */
  outsideWindow: number
  /** Set when we could not make sense of the file at all. */
  error?: string
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    // Async so a large Takeout archive does not freeze the tab.
    unzip(bytes, (err, files) => (err ? reject(err) : resolve(files)))
  })
}

function parseMember(path: string, bytes: Uint8Array): ParseResult {
  const takeoutSource = takeoutSourceForPath(path)
  if (takeoutSource) {
    const text = strFromU8(bytes)
    return isHtmlActivity(path)
      ? parseTakeoutHtml(text, takeoutSource)
      : parseTakeoutActivity(text, takeoutSource)
  }
  if (path.toLowerCase().endsWith('conversations.json')) {
    return {
      records: parseChatGPTExport(strFromU8(bytes)),
      unrecognised: 0,
      contentless: 0,
      undated: 0,
    }
  }
  return { records: [], unrecognised: 0, contentless: 0, undated: 0 }
}

export async function readArchive(
  file: File,
  window?: { from?: Date; to?: Date },
  /**
   * Sources the respondent actually granted. A Takeout archive routinely
   * contains a dozen products they never agreed to share, and anything outside
   * this list is dropped here - before it reaches the review list, so it can
   * never be released by an absent-minded "include all".
   */
  allowed?: SourceKind[]
): Promise<IntakeReport> {
  const permitted = allowed ? new Set(allowed) : null
  const keep = (records: ActivityRecord[]) =>
    permitted ? records.filter((r) => permitted.has(r.source)) : records

  const bytes = new Uint8Array(await file.arrayBuffer())
  const report: IntakeReport = {
    records: [],
    read: [],
    empty: [],
    unrecognised: 0,
    contentless: 0,
    undated: 0,
    duplicates: 0,
    outsideWindow: 0,
  }

  // A bare conversations.json, not zipped. Common enough to support.
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = parseMember(file.name, bytes)
    report.unrecognised += parsed.unrecognised
    report.contentless += parsed.contentless
    report.undated += parsed.undated
    const records = keep(parsed.records)
    if (records.length) {
      report.read.push(file.name)
    } else {
      report.empty.push(file.name)
      report.error =
        'That JSON file did not contain any recognisable activity. If it came from ChatGPT it should be conversations.json.'
    }
    const normalised = normalise(records, window)
    report.records = normalised.records
    report.duplicates = normalised.duplicates
    report.outsideWindow = normalised.outsideWindow
    return report
  }

  let members: Record<string, Uint8Array>
  try {
    members = await unzipAsync(bytes)
  } catch {
    return {
      ...report,
      error:
        'That file could not be opened as a zip archive. Please pick the export file exactly as it was downloaded.',
    }
  }

  const all: ActivityRecord[] = []
  for (const [path, content] of Object.entries(members)) {
    if (!content.length) continue
    const parsed = parseMember(path, content)
    report.unrecognised += parsed.unrecognised
    report.contentless += parsed.contentless
    report.undated += parsed.undated
    const records = keep(parsed.records)
    if (!records.length) {
      if (takeoutSourceForPath(path) || path.endsWith('conversations.json')) {
        report.empty.push(path)
      }
      continue
    }
    report.read.push(path)
    all.push(...records)
  }

  const normalised = normalise(all, window)
  report.records = normalised.records
  report.duplicates = normalised.duplicates
  report.outsideWindow = normalised.outsideWindow

  if (!report.read.length && !report.empty.length) {
    report.error =
      'No search or conversation history was found in that archive. For Google, make sure "My Activity" was included in the export.'
  }

  return report
}
