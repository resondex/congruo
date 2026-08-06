'use client'

import { useState } from 'react'

/**
 * Issues a reset link and shows it once.
 *
 * The admin never sees or sets the password: they hand over a link and the
 * person chooses their own. Issuing a new link revokes any earlier one, so a
 * reset sent to the wrong place can be undone by sending another.
 */
export default function ResetButton({
  userId,
  email,
}: {
  userId: string
  email: string
}) {
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function issue() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/resets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Could not create a reset link.')
        return
      }
      setLink(data.url)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (link) {
    return (
      <div className="mt-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full overflow-x-auto rounded bg-neutral-50 px-2 py-1 text-xs">
            {link}
          </code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
            }}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Send this to {email}. Valid once, for 24 hours.
        </p>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void issue()}
        disabled={busy}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Reset password'}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </>
  )
}
