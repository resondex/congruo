'use client'

import { useState } from 'react'

export default function ForgotForm() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const response = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      // The same message whatever happened, including when nothing did.
      setMessage(data.message ?? 'If that address has an account, a reset link is on its way.')
    } catch {
      setMessage('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (message) {
    return (
      <p className="mt-8 rounded-md border border-neutral-900 bg-neutral-50 px-4 py-3 text-sm">
        {message}
      </p>
    )
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
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send me a link'}
      </button>
    </form>
  )
}
