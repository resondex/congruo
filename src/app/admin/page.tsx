import Link from 'next/link'
import { requireUser, canEditStudies } from '@/lib/auth'
import { studiesFor } from '@/lib/admin_store'

/** The rate the whole model rests on: of those who answered, how many shared. */
function releaseRate(surveyed: number, released: number) {
  if (!surveyed) return null
  return Math.round((released / surveyed) * 100)
}

export default async function StudiesPage() {
  const user = await requireUser()
  const studies = await studiesFor(user)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Studies</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {user.role === 'staff'
              ? 'Every study on this deployment.'
              : `Studies belonging to ${user.orgName ?? 'your organisation'}.`}
          </p>
        </div>
        {canEditStudies(user) && (
          <Link
            href="/admin/studies/new"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            New study
          </Link>
        )}
      </div>

      {studies.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="font-medium">No studies yet</p>
          <p className="mt-1 text-sm text-neutral-600">
            {canEditStudies(user)
              ? 'Create one to get a link you can send to respondents.'
              : 'Nothing has been shared with your organisation yet.'}
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Study</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 text-right font-medium">Questions</th>
                <th className="px-4 py-3 text-right font-medium">Started</th>
                <th className="px-4 py-3 text-right font-medium">Surveyed</th>
                <th className="px-4 py-3 text-right font-medium">Released</th>
                <th className="px-4 py-3 text-right font-medium">Release rate</th>
                <th className="px-4 py-3 text-right font-medium">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {studies.map((s) => {
                const rate = releaseRate(s.surveyed, s.released)
                return (
                  <tr key={s.slug} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/studies/${s.slug}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="block text-xs text-neutral-500">
                        {s.slug}
                        {user.role === 'staff' && (
                          <> · {s.orgName ?? 'unowned'}</>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {s.mode === 'append' ? 'Append' : 'Full service'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.questionCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.started.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.surveyed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.released.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {rate === null ? (
                        <span className="text-neutral-400">-</span>
                      ) : (
                        `${rate}%`
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.records.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
