import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser, canEditStudies } from '@/lib/auth'
import { studyFor, orgsFor } from '@/lib/admin_store'
import { getStudy } from '@/lib/studies'
import StudyForm from '../StudyForm'
import StudyLink from './StudyLink'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}

export default async function StudyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireUser()

  const summary = await studyFor(user, slug)
  if (!summary) notFound()

  // The respondent-facing record, for the fields the summary does not carry.
  const study = await getStudy(slug)
  const orgs = await orgsFor(user)
  const editable = canEditStudies(user)

  const rate = summary.surveyed
    ? Math.round((summary.released / summary.surveyed) * 100)
    : null

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {summary.name}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {summary.mode === 'append' ? 'Append' : 'Full service'} ·{' '}
            {summary.orgName ?? 'no organisation'} · {summary.questionCount}{' '}
            {summary.questionCount === 1 ? 'question' : 'questions'}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/studies/${slug}/questions`}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:border-neutral-500"
          >
            {editable ? 'Edit questions' : 'View questions'}
          </Link>
          <Link
            href={`/admin/studies/${slug}/data`}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Data
          </Link>
        </div>
      </div>

      <StudyLink slug={slug} mode={summary.mode} />

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Started" value={summary.started.toLocaleString()} />
        <Stat label="Surveyed" value={summary.surveyed.toLocaleString()} />
        <Stat label="Released" value={summary.released.toLocaleString()} />
        <Stat
          label="Release rate"
          value={rate === null ? '-' : `${rate}%`}
          hint="of those who answered"
        />
        <Stat label="Declined" value={summary.declined.toLocaleString()} />
        <Stat label="Screened out" value={summary.screenedOut.toLocaleString()} />
        <Stat label="Reconciled" value={summary.reconciled.toLocaleString()} />
        <Stat label="Records" value={summary.records.toLocaleString()} />
      </div>

      {editable ? (
        <>
          <h2 className="mt-12 text-lg font-medium">Settings</h2>
          <StudyForm
            existing
            canChooseOrg={user.role === 'staff'}
            orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
            initial={{
              slug,
              name: summary.name,
              mode: summary.mode,
              orgId: summary.orgId,
              sources: summary.sources as never,
              returnHosts: study?.returnHosts ?? [],
              defaultReturnUrl: study?.defaultReturnUrl ?? null,
              windowFrom: study?.window?.from ?? null,
              windowTo: study?.window?.to ?? null,
              exportRawText: summary.exportRawText,
            }}
          />
        </>
      ) : (
        <p className="mt-10 text-sm text-neutral-500">
          You have view access to this study. Ask an admin at{' '}
          {summary.orgName ?? 'your organisation'} to change how it is set up.
        </p>
      )}
    </>
  )
}
