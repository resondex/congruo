'use client'

import { useState } from 'react'

interface Holding {
  studyName: string
  startedAt: string
  records: number
  answers: number
  hasReconciled: boolean
}

export default function DeleteForm({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken)
  const [holding, setHolding] = useState<Holding | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function look(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'That reference is not valid.')
        return
      }
      setHolding(data.holding)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/delete', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not remove it. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-8 rounded-lg border border-neutral-900 bg-neutral-50 p-5">
        <p className="font-medium">It is gone.</p>
        <p className="mt-2 text-sm text-neutral-600">
          Your answers, your records and everything computed from them have been
          deleted. What remains is a note that a participant withdrew, with
          nothing in it about you - kept so the study&apos;s own counts stay
          honest.
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Your reference no longer works, so keep this page if you want a record
          of it.
        </p>
      </div>
    )
  }

  if (holding) {
    return (
      <div className="mt-8">
        <div className="rounded-lg border border-neutral-300 bg-white p-5">
          <p className="text-sm text-neutral-600">
            {holding.studyName}, started{' '}
            {new Date(holding.startedAt).toLocaleDateString()}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              <strong className="tabular-nums">
                {holding.records.toLocaleString()}
              </strong>{' '}
              records you released
            </li>
            <li>
              <strong className="tabular-nums">{holding.answers}</strong> survey
              answers
            </li>
            {holding.hasReconciled && <li>What you told us about the differences</li>}
          </ul>
        </div>

        <p className="mt-4 max-w-prose text-sm text-neutral-600">
          All of it will be deleted. This cannot be undone, and afterwards there
          will be nothing left for us to check it against - so make sure this is
          the right one.
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-md bg-red-700 px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Delete all of it'}
          </button>
          <button
            type="button"
            onClick={() => setHolding(null)}
            className="text-sm text-neutral-500 underline hover:text-neutral-900"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={look} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">
          Your reference
        </span>
        <input
          type="text"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2.5 font-mono text-sm focus:border-neutral-900 focus:outline-none"
        />
      </label>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !token.trim()}
        className="rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Looking…' : 'Show me what you hold'}
      </button>
    </form>
  )
}
