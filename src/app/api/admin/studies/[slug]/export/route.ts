import type { NextRequest } from 'next/server'
import { dbConfigured } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { studyFor } from '@/lib/admin_store'
import {
  toCsv,
  responsesTable,
  recordsTable,
  reconcileTable,
  codebookTable,
} from '@/lib/export'

/**
 * Downloads a study's data as CSV.
 *
 * Scoped exactly like every other read: the study is fetched through
 * studyFor, which returns nothing for a study the caller may not see. A
 * download endpoint is the worst place to reimplement an access check, so it
 * does not have one of its own.
 *
 * A viewer may download. That is the whole point of the tier - being able to
 * read a study you cannot edit - and withholding the file would leave them
 * asking someone else to email it, which is worse for everyone.
 */

const TABLES = ['responses', 'records', 'reconcile', 'codebook'] as const
type TableName = (typeof TABLES)[number]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  const { slug } = await params
  const study = await studyFor(user, slug)
  if (!study) return Response.json({ error: 'No such study.' }, { status: 404 })

  const name = new URL(request.url).searchParams.get('table') ?? 'responses'
  if (!TABLES.includes(name as TableName)) {
    return Response.json({ error: 'Unknown table.' }, { status: 400 })
  }

  // The study's own setting decides, not the request. A download parameter
  // that could turn raw text back on would make the setting decorative.
  const rawText = study.exportRawText

  let csv: string
  try {
    const table =
      name === 'records'
        ? await recordsTable(slug, rawText)
        : name === 'reconcile'
          ? await reconcileTable(slug)
          : name === 'codebook'
            ? await codebookTable(slug, rawText)
            : await responsesTable(slug, rawText)
    csv = toCsv(table)
  } catch (error) {
    console.error('export failed', error)
    return Response.json({ error: 'Could not build that file.' }, { status: 500 })
  }

  const stamp = new Date().toISOString().slice(0, 10)
  // Leading byte-order mark. Without it Excel on Windows reads the file as
  // the local codepage and renders every accent and curly quote as mojibake -
  // and this file is full of what people typed.
  return new Response('\ufeff' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}_${name}_${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
