'use client'

import { useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Sign in with a passkey.
   *
   * No email is asked for and none is sent: the authenticator knows which key
   * belongs to this site. That is the point - it is also why a copy of this
   * page on another domain cannot use one, which no password or typed code can
   * claim.
   */
  async function withPasskey() {
    setBusy(true)
    setError(null)
    try {
      const options = await fetch('/api/auth/passkey/login').then((r) => r.json())
      if (options.error) {
        setError(options.error)
        return
      }
      const assertion = await startAuthentication({ optionsJSON: options })
      const response = await fetch('/api/auth/passkey/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(assertion),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'That passkey did not work.')
        return
      }
      window.location.href = next
    } catch (error) {
      // Cancelling the system prompt lands here and is not a failure worth
      // shouting about.
      if ((error as Error)?.name !== 'NotAllowedError') {
        setError('That passkey did not work.')
      }
    } finally {
      setBusy(false)
    }
  }

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

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">or</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void withPasskey()}
        className="w-full rounded-md border border-neutral-300 px-5 py-2.5 font-medium hover:border-neutral-500 disabled:opacity-50"
      >
        Use a passkey
      </button>

      <a
        href="/forgot"
        className="block text-center text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        I forgot my password
      </a>
    </form>
  )
}
