'use client'

/**
 * The full-service flow: consent, request, wait, review, release.
 *
 * Resumability is the point. Exports take minutes to hours, so the respondent
 * will close the tab and come back later - probably when the vendor's email
 * lands. Progress is kept in localStorage against the study slug, so returning
 * to the same link on the same device picks up where they left off. There is no
 * account, and there should not be one: a respondent arrives from a link and
 * leaves within the session.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import ConsentAndRequest from './ConsentAndRequest'
import ReviewAndRelease from './ReviewAndRelease'
import { SOURCE_LABELS, type SourceKind } from '@/lib/records'

type Step = 'consent' | 'waiting' | 'review' | 'declined'

interface Progress {
  step: Step
  granted: SourceKind[]
  requestedAt: string
}

interface Props {
  studySlug: string
  studyName: string
  sources: SourceKind[]
  disclosureVersion: string
  window?: { from?: Date; to?: Date }
}

/**
 * A tiny localStorage-backed store per study, read through
 * useSyncExternalStore.
 *
 * Reading storage in an effect would mean rendering the consent screen first
 * and then replacing it, so a returning respondent would see a flash of the
 * step they already completed. The server snapshot is always null, which keeps
 * the first client render identical to the server's and avoids a hydration
 * mismatch; the stored value arrives immediately after.
 */
const stores = new Map<string, ReturnType<typeof createStore>>()

function createStore(slug: string) {
  const key = `congruo:${slug}`
  const listeners = new Set<() => void>()
  // getSnapshot must return a stable reference or React re-renders forever.
  let cache: string | null | undefined

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get(): string | null {
      if (cache === undefined) {
        try {
          cache = localStorage.getItem(key)
        } catch {
          cache = null // Private browsing: the flow works, it just will not resume.
        }
      }
      return cache
    },
    set(value: string | null) {
      cache = value
      try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {
        // Non-fatal.
      }
      listeners.forEach((l) => l())
    },
  }
}

function storeFor(slug: string) {
  let store = stores.get(slug)
  if (!store) {
    store = createStore(slug)
    stores.set(slug, store)
  }
  return store
}

export default function StudyFlow({
  studySlug,
  studyName,
  sources,
  disclosureVersion,
  window: studyWindow,
}: Props) {
  const store = storeFor(studySlug)
  const raw = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => null // server render: always the starting state
  )
  const [error, setError] = useState<string | null>(null)

  let progress: Progress | null = null
  if (raw) {
    try {
      progress = JSON.parse(raw) as Progress
    } catch {
      progress = null // Corrupt entry: start from the top rather than crash.
    }
  }

  const save = useCallback(
    (next: Progress | null) => {
      store.set(next ? JSON.stringify(next) : null)
    },
    [store]
  )

  async function submitConsent(granted: SourceKind[], next: Step) {
    setError(null)
    try {
      const response = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studySlug,
          disclosureVersion,
          comprehensionPassed: true,
          grants: sources.map((source) => ({
            source,
            granted: granted.includes(source),
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not record your choices.')
        return
      }
    } catch {
      setError('Could not reach the server. Please try again.')
      return
    }
    save({ step: next, granted, requestedAt: new Date().toISOString() })
  }

  if (!progress || progress.step === 'consent') {
    return (
      <>
        {error && (
          <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </p>
        )}
        <ConsentAndRequest
          sources={sources}
          disclosureVersion={disclosureVersion}
          onContinue={(granted) => void submitConsent(granted, 'waiting')}
          onDecline={() => void submitConsent([], 'declined')}
        />
      </>
    )
  }

  if (progress.step === 'declined') {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Thank you for your time
        </h1>
        <p className="mt-3 text-neutral-600">
          You chose not to share your history, and nothing was collected.
        </p>
        <button
          type="button"
          onClick={() => save(null)}
          className="mt-8 text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Start again
        </button>
      </section>
    )
  }

  if (progress.step === 'waiting') {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Your file is being prepared
        </h1>
        <p className="mt-3 max-w-prose text-neutral-600">
          {SOURCE_LABELS[progress.granted[0]] ?? 'The service'}
          {progress.granted.length > 1
            ? ` and ${progress.granted.length - 1} more`
            : ''}{' '}
          will email you when your download is ready. That usually takes a few
          minutes, and occasionally a few hours.
        </p>

        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-5">
          <p className="text-sm font-medium text-neutral-900">
            The survey runs here
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            In a live study you would answer questions on this screen while your
            file is prepared. That part is not built yet.
          </p>
        </div>

        <p className="mt-8 max-w-prose text-sm text-neutral-600">
          You can close this page. Come back to the same link on this device
          when your download has arrived and you will pick up here.
        </p>

        <button
          type="button"
          onClick={() => save({ ...progress, step: 'review' })}
          className="mt-6 rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white"
        >
          I have my file
        </button>
        <button
          type="button"
          onClick={() => save({ ...progress, step: 'consent' })}
          className="mt-4 block text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Show me the request instructions again
        </button>
      </section>
    )
  }

  return (
    <>
      <p className="mb-8 text-sm text-neutral-500">
        {studyName} · step 3 of 3
      </p>
      <ReviewAndRelease
        studySlug={studySlug}
        window={studyWindow}
        allowedSources={sources}
      />
    </>
  )
}
