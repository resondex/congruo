'use client'

import { useState } from 'react'

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not sign you in.')
        return
      }
      // A full navigation rather than a router push: the session cookie was
      // just set, and every page behind this reads it on the server.
      window.location.href = next
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-neutral-700">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2.5 focus:border-neutral-900 focus:outline-none"
        />
      </label>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
