'use client'

import { useState } from 'react'

/**
 * Creates an invitation and shows the link once.
 *
 * There is no mail sender yet - congruo.ai has no verified sending domain - so
 * the link is copied and sent through whatever channel already exists with the
 * person. Shown once because only the hash is stored: it cannot be looked up
 * again, by us or by anyone who takes a copy of the database.
 */
export default function InviteForm({
  canInviteStaff,
  orgs,
  fixedOrgId,
}: {
  canInviteStaff: boolean
  orgs: { id: string; name: string }[]
  fixedOrgId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('client_viewer')
  const [orgId, setOrgId] = useState(fixedOrgId ?? orgs[0]?.id ?? '')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsOrg = role !== 'staff'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setLink(null)
    try {
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          orgId: needsOrg ? (fixedOrgId ?? orgId) : null,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Could not create that invitation.')
        return
      }
      setLink(data.url)
      setEmail('')
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Invite someone
      </button>
    )
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-300 bg-white p-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1">
          <span className="text-sm font-medium text-neutral-700">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="text-sm font-medium text-neutral-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="client_viewer">Viewer - read and download</option>
            <option value="client_admin">Admin - create and edit studies</option>
            {canInviteStaff && <option value="staff">Staff - everything</option>}
          </select>
        </label>

        {needsOrg && !fixedOrgId && (
          <label>
            <span className="text-sm font-medium text-neutral-700">
              Organisation
            </span>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="submit"
          disabled={busy || (needsOrg && !fixedOrgId && !orgId)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Cancel
        </button>
      </form>

      {needsOrg && !fixedOrgId && orgs.length === 0 && (
        <p className="mt-3 text-sm text-amber-800">
          There are no organisations yet. Create one before inviting a client.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {link && (
        <div className="mt-4 rounded-md border border-neutral-900 bg-neutral-50 p-4">
          <p className="text-sm font-medium">Send them this link</p>
          <p className="mt-1 text-xs text-neutral-600">
            It works once and expires in seven days. It is not stored anywhere
            you can read it again, so copy it now.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-xs">
              {link}
            </code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(link)
                setCopied(true)
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:border-neutral-500"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
