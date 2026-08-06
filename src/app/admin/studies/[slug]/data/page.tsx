import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { studyFor } from '@/lib/admin_store'
import { dataOverview } from '@/lib/data_view'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}

const FILES = [
  { table: 'responses', name: 'Responses', hint: 'One row per respondent, wide. The file to analyse.' },
  { table: 'codebook', name: 'Codebook', hint: 'What every column in that file means.' },
  { table: 'records', name: 'Records', hint: 'One row per released search or prompt.' },
  { table: 'reconcile', name: 'Reconciliation', hint: 'Divergences and what respondents said about them.' },
]

export default async function DataPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireUser()

  const summary = await studyFor(user, slug)
  if (!summary) notFound()
  const view = await dataOverview(slug)

  return (
    <>
      <Link
        href={`/admin/studies/${slug}`}
        className="text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        ← {summary.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Data</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Started" value={summary.started.toLocaleString()} />
        <Stat
          label="Completed the survey"
          value={summary.surveyed.toLocaleString()}
          hint={
            summary.started
              ? `${Math.round((summary.surveyed / summary.started) * 100)}% of those who started`
              : undefined
          }
        />
        <Stat
          label="Released records"
          value={summary.released.toLocaleString()}
          hint={
            summary.surveyed
              ? `${Math.round((summary.released / summary.surveyed) * 100)}% of those who answered`
              : undefined
          }
        />
        <Stat label="Records held" value={summary.records.toLocaleString()} />
      </div>

      {view.qualityRun > 0 && (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="font-medium">Quality checks</h2>
          <p className="mt-1 max-w-prose text-sm text-neutral-600">
            <strong className="tabular-nums">{view.sessionsFailing}</strong> of{' '}
            <strong className="tabular-nums">{view.sessionsChecked}</strong>{' '}
            respondents failed at least one, across{' '}
            <strong className="tabular-nums">{view.qualityRun}</strong> checks run.
            They are flagged, not removed - their records are still good and only
            their self-report is in doubt, so whether to drop them is your call
            at analysis rather than ours at collection.
          </p>
        </div>
      )}

      {view.reconciled > 0 && (
        <div className="mt-6 rounded-lg border border-neutral-900 bg-white p-5">
          <h2 className="font-medium">Where self-report met the record</h2>
          <p className="mt-1 text-sm text-neutral-600">
            <strong className="tabular-nums">{view.comparisonsAgreed}</strong> of{' '}
            <strong className="tabular-nums">{view.comparisonsTotal}</strong>{' '}
            comparisons agreed.
          </p>
          {view.explanations.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {view.explanations.map((e) => (
                <li key={e.explanation} className="flex justify-between gap-4">
                  <span className="text-neutral-700">
                    {EXPLANATION_TEXT[e.explanation] ?? e.explanation}
                  </span>
                  <span className="tabular-nums text-neutral-500">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 max-w-prose text-xs text-neutral-500">
            &quot;I did not count that as the same thing&quot; is the one to read
            closely - it says the question and the record were never measuring
            the same thing, which is a finding about the instrument rather than
            about the respondent.
          </p>
        </div>
      )}

      <h2 className="mt-10 text-lg font-medium">Download</h2>
      {!summary.exportRawText && (
        <p className="mt-1 max-w-prose text-sm text-amber-800">
          This study is set to withhold verbatim text. The files carry counts,
          timings, codes and congruence, and not what anybody typed or what an
          assistant answered.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FILES.map((f) => (
          <a
            key={f.table}
            href={`/api/admin/studies/${slug}/export?table=${f.table}`}
            className="rounded-lg border border-neutral-300 bg-white p-4 transition hover:border-neutral-900"
          >
            <span className="font-medium">{f.name}</span>
            <span className="mt-0.5 block text-sm text-neutral-600">{f.hint}</span>
            <span className="mt-2 block text-xs text-neutral-500">CSV</span>
          </a>
        ))}
      </div>
    </>
  )
}

const EXPLANATION_TEXT: Record<string, string> = {
  different_meaning: 'I did not count that as the same thing',
  withheld: 'I chose not to share some of those',
  other_device: 'I did it somewhere this file does not cover',
  not_me: 'Someone else was using my account',
  misremembered: 'I misremembered - the record looks right',
  record_wrong: 'The record does not look right to me',
  other: 'Something else',
}
