'use client'

import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'

export interface Passkey {
  id: string
  label: string | null
  createdAt: string
  lastUsedAt: string | null
}

export default function Passkeys({ initial }: { initial: Passkey[] }) {
  const [keys, setKeys] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const options = await fetch('/api/auth/passkey/register').then((r) => r.json())
      if (options.error) {
        setError(options.error)
        return
      }
      const attestation = await startRegistration({ optionsJSON: options })
      const label =
        // A name they will recognise later, guessed from the browser rather
        // than asked for - one fewer field between them and a passkey.
        navigator.platform || navigator.userAgent.split(') ')[0]?.split(' (')[1] || null
      const response = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: attestation, label }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'That passkey could not be added.')
        return
      }
      setKeys((k) => [
        ...k,
        { id: attestation.id, label, createdAt: new Date().toISOString(), lastUsedAt: null },
      ])
    } catch (error) {
      if ((error as Error)?.name !== 'NotAllowedError') {
        setError('That passkey could not be added.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await fetch(`/api/auth/passkey/register?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    setKeys((k) => k.filter((x) => x.id !== id))
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="font-medium">Passkeys</h2>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        Sign in with the fingerprint, face or PIN you already use to unlock this
        device, or with a passkey held in your password manager. The secret
        never leaves it, and a passkey cannot be handed to a copy of this page
        on another domain - which is the one thing a password or a typed code
        cannot promise.
      </p>

      {keys.length > 0 && (
        <ul className="mt-4 divide-y divide-neutral-100 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 py-2">
              <span className="font-medium">{k.label ?? 'Passkey'}</span>
              <span className="text-xs text-neutral-500">
                added {new Date(k.createdAt).toLocaleDateString()}
                {k.lastUsedAt
                  ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                  : ' · not used yet'}
              </span>
              <button
                type="button"
                onClick={() => void remove(k.id)}
                className="ml-auto text-xs text-neutral-500 underline hover:text-red-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Waiting for your device…' : 'Add a passkey'}
      </button>
    </div>
  )
}
