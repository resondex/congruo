'use client'

import { useState } from 'react'

export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < 12
  const mismatch = again.length > 0 && password !== again

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not set that password.')
        return
      }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/admin'
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">New password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          At least 12 characters.
        </span>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">Again</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
        />
      </label>

      {(error || tooShort || mismatch) && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error ?? (tooShort ? 'Use at least 12 characters.' : 'Those do not match.')}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || tooShort || mismatch || !password}
        className="w-full rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Setting…' : 'Set password'}
      </button>
    </form>
  )
}
