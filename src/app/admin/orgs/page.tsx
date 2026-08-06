import { redirect } from 'next/navigation'
import { requireUser, isStaff } from '@/lib/auth'
import { orgsFor } from '@/lib/admin_store'

export default async function OrgsPage() {
  const user = await requireUser()
  // Clients have exactly one org and no reason to browse a list of them.
  if (!isStaff(user)) redirect('/admin')

  const orgs = await orgsFor(user)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Organisations</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        Client accounts belong to an organisation, and it is the whole of the
        access model - every query a client makes is filtered by it.
      </p>

      {orgs.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="font-medium">No organisations yet</p>
          <p className="mt-1 text-sm text-neutral-600">
            Create one from the command line, then add its first account:
          </p>
          <pre className="mx-auto mt-4 w-fit rounded-md bg-neutral-900 px-4 py-3 text-left text-xs text-neutral-100">
            npm run create-org -- --name &quot;Acme Inc&quot; --slug acme{'\n'}
            npm run create-user -- --email you@acme.com --role client_admin
            --org acme
          </pre>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 text-right font-medium">Studies</th>
                <th className="px-4 py-3 text-right font-medium">People</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3 text-neutral-600">{o.slug}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.studies}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.users}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
