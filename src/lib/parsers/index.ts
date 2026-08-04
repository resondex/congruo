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
} from './takeout'
import { parseChatGPTExport } from './chatgpt'

export interface IntakeReport {
  records: ActivityRecord[]
  /** Archive members we recognised and parsed. */
  read: string[]
  /** Archive members we recognised but that yielded nothing. */
  empty: string[]
  /** Set when we could not make sense of the file at all. */
  error?: string
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    // Async so a large Takeout archive does not freeze the tab.
    unzip(bytes, (err, files) => (err ? reject(err) : resolve(files)))
  })
}

function parseMember(path: string, bytes: Uint8Array): ActivityRecord[] {
  const takeoutSource = takeoutSourceForPath(path)
  if (takeoutSource) {
    const text = strFromU8(bytes)
    return isHtmlActivity(path)
      ? parseTakeoutHtml(text, takeoutSource)
      : parseTakeoutActivity(text, takeoutSource)
  }
  if (path.toLowerCase().endsWith('conversations.json')) {
    return parseChatGPTExport(strFromU8(bytes))
  }
  return []
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
  const report: IntakeReport = { records: [], read: [], empty: [] }

  // A bare conversations.json, not zipped. Common enough to support.
  if (file.name.toLowerCase().endsWith('.json')) {
    const records = keep(parseMember(file.name, bytes))
    if (records.length) {
      report.read.push(file.name)
    } else {
      report.empty.push(file.name)
      report.error =
        'That JSON file did not contain any recognisable activity. If it came from ChatGPT it should be conversations.json.'
    }
    report.records = normalise(records, window)
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
    const records = keep(parseMember(path, content))
    if (!records.length) {
      if (takeoutSourceForPath(path) || path.endsWith('conversations.json')) {
        report.empty.push(path)
      }
      continue
    }
    report.read.push(path)
    all.push(...records)
  }

  report.records = normalise(all, window)

  if (!report.read.length && !report.empty.length) {
    report.error =
      'No search or conversation history was found in that archive. For Google, make sure you chose JSON rather than HTML, and included My Activity.'
  }

  return report
}
