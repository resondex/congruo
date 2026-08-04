/**
 * Converts a Takeout archive to a flat JSON table for inspection.
 *
 * Run:  npm run inspect -- ~/Downloads/takeout-....zip
 *
 * Development tool, not part of the app. It exists so decisions about which
 * sources and actions a study keeps can be made by looking at real data rather
 * than at assumptions about the format.
 *
 * Output is written next to the archive, never into this repo: it is somebody's
 * search history and the repo is public. See the first block of .gitignore.
 */

import fs from 'node:fs'
import path from 'node:path'
import { readArchive } from '../.inspect/parsers.mjs'

const input = process.argv[2]
if (!input) {
  console.error('Usage: npm run inspect -- <path-to-takeout.zip>')
  process.exit(1)
}

const archivePath = input.replace(/^~/, process.env.HOME ?? '~')
if (!fs.existsSync(archivePath)) {
  console.error(`Not found: ${archivePath}`)
  process.exit(1)
}

const buf = fs.readFileSync(archivePath)
const file = new File([buf], path.basename(archivePath), {
  type: 'application/zip',
})

// No consent filter and no window: this is the raw extraction, so the shape of
// what is available can be seen before any policy is applied.
const report = await readArchive(file)

const out = archivePath.replace(/\.zip$/, '') + '.records.json'
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      archive: path.basename(archivePath),
      generatedAt: new Date().toISOString(),
      filesParsed: report.read,
      filesEmpty: report.empty,
      recordCount: report.records.length,
      records: report.records,
    },
    null,
    2
  )
)

// Summary only. Never print the records themselves.
const grid = new Map()
const actions = new Set()
for (const r of report.records) {
  actions.add(r.action)
  const row = grid.get(r.source) ?? {}
  row[r.action] = (row[r.action] ?? 0) + 1
  grid.set(r.source, row)
}

const cols = [...actions].sort()
const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

console.log(`\nParsed ${report.read.length} files, ${report.records.length} records\n`)
console.log(pad('SOURCE', 22) + cols.map((c) => num(c, 10)).join('') + num('TOTAL', 10))
for (const [source, row] of [...grid.entries()].sort()) {
  const total = Object.values(row).reduce((a, b) => a + b, 0)
  console.log(
    pad(source, 22) + cols.map((c) => num(row[c] ?? 0, 10)).join('') + num(total, 10)
  )
}

const withUrl = report.records.filter((r) => r.url).length
const times = report.records.map((r) => r.timestamp).sort()
console.log(`\nrange     ${times[0]?.slice(0, 10)} -> ${times.at(-1)?.slice(0, 10)}`)
console.log(`with url  ${withUrl} of ${report.records.length}`)
if (report.error) console.log(`note      ${report.error}`)
console.log(`\nwritten   ${out}`)
