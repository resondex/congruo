import { requireUser, canEditStudies } from '@/lib/auth'
import { peopleFor, orgsFor } from '@/lib/admin_store'
import { pendingInvites } from '@/lib/invites'
import InviteForm from './InviteForm'

const ROLE_LABEL: Record<string, string> = {
  staff: 'Staff',
  client_admin: 'Admin',
  client_viewer: 'Viewer',
}

export default async function PeoplePage() {
  const user = await requireUser()
  const [people, invites, orgs] = await Promise.all([
    peopleFor(user),
    pendingInvites(user),
    orgsFor(user),
  ])

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        {user.role === 'staff'
          ? 'Everyone with an account, across every organisation.'
          : `Everyone at ${user.orgName ?? 'your organisation'}.`}
      </p>

      {canEditStudies(user) && (
        <InviteForm
          canInviteStaff={user.role === 'staff'}
          orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
          fixedOrgId={user.role === 'staff' ? null : user.orgId}
        />
      )}

      <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Role</th>
              {user.role === 'staff' && (
                <th className="px-4 py-3 font-medium">Organisation</th>
              )}
              <th className="px-4 py-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {people.map((p) => (
              <tr key={p.id} className={p.disabledAt ? 'opacity-50' : undefined}>
                <td className="px-4 py-3">
                  <span className="font-medium">{p.name ?? p.email}</span>
                  {p.name && (
                    <span className="block text-xs text-neutral-500">
                      {p.email}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {ROLE_LABEL[p.role] ?? p.role}
                  {p.disabledAt && ' · disabled'}
                </td>
                {user.role === 'staff' && (
                  <td className="px-4 py-3 text-neutral-600">
                    {p.orgName ?? '-'}
                  </td>
                )}
                <td className="px-4 py-3 text-neutral-500">
                  {p.lastSeenAt
                    ? new Date(p.lastSeenAt).toLocaleDateString()
                    : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <>
          <h2 className="mt-10 font-medium">Waiting to be accepted</h2>
          <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-sm">
            {invites.map((i) => (
              <li key={i.email} className="flex flex-wrap gap-x-4 px-4 py-3">
                <span className="font-medium">{i.email}</span>
                <span className="text-neutral-600">
                  {ROLE_LABEL[i.role] ?? i.role}
                  {i.orgName ? ` · ${i.orgName}` : ''}
                </span>
                <span className="ml-auto text-neutral-500">
                  expires {new Date(i.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
