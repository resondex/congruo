'use client'

/**
 * The full-service flow: consent, request, survey, wait, review, release.
 *
 * The survey sits before the wait rather than after it, so the export builds
 * while the respondent answers. It also has to finish before they reach review
 * (invariant 2), and putting it here means that ordering is a property of the
 * flow rather than something a later change has to remember.
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
import Survey from './Survey'
import Reconcile from './Reconcile'
import { SOURCE_LABELS, type SourceKind } from '@/lib/records'
import type { AnswerValue, Answers, Question } from '@/lib/survey'

type Step =
  | 'consent'
  | 'survey'
  | 'waiting'
  | 'review'
  | 'reconcile'
  | 'done'
  | 'declined'
  | 'screened_out'

interface Progress {
  step: Step
  granted: SourceKind[]
  requestedAt: string
  /**
   * The session opened at consent, carried through the rest of the flow.
   *
   * A full-service respondent has no external id, so without this every step
   * would open its own row and their answers could never be joined to their
   * records. It is not a credential - it identifies a row we created for this
   * person and holds nothing until they put something in it.
   */
  sessionId?: string
  /**
   * Kept locally as they are given, not only on submit. Half an instrument
   * answered on a bus is real effort, and losing it to a closed tab is how a
   * respondent decides not to come back.
   */
  answers?: Answers
}

interface Props {
  studySlug: string
  studyName: string
  sources: SourceKind[]
  disclosureVersion: string
  questions: Question[]
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
  questions,
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
    let sessionId: string | undefined
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
      const data = await response.json().catch(() => ({}))
      if (typeof data.sessionId === 'string') sessionId = data.sessionId
    } catch {
      setError('Could not reach the server. Please try again.')
      return
    }
    save({
      step: next,
      granted,
      sessionId,
      requestedAt: new Date().toISOString(),
    })
  }

  /**
   * Submits the instrument. Returns a message on failure so the survey can
   * keep the respondent on the page with their answers intact - advancing on a
   * failed write would send someone to review having contributed no
   * self-report, which is exactly what invariant 2 protects against.
   */
  async function submitSurvey(current: Progress): Promise<string | null> {
    try {
      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studySlug,
          sessionId: current.sessionId,
          answers: current.answers ?? {},
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return data.error ?? 'Could not save your answers.'
      }
      const data = await response.json().catch(() => ({}))
      // Screening is decided on the server from the study's own rules, not
      // here. The client evaluates the same conditions to route the form, but
      // whether someone qualifies is not a thing a browser gets to assert.
      if (data.screenedOut) {
        save({ ...current, step: 'screened_out' })
        return null
      }
    } catch {
      return 'Could not reach the server. Please try again.'
    }
    save({ ...current, step: 'waiting' })
    return null
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
          onContinue={(granted) =>
            void submitConsent(granted, questions.length ? 'survey' : 'waiting')
          }
          onDecline={() => void submitConsent([], 'declined')}
        />
      </>
    )
  }

  if (progress.step === 'screened_out') {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Thank you for your time
        </h1>
        <p className="mt-3 max-w-prose text-neutral-600">
          Based on your answers, this particular study is not a match. You do
          not need to do anything else, and there is no file to share.
        </p>
      </section>
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

  // A study whose questions were removed after this respondent started would
  // otherwise strand them on an empty survey.
  if (progress.step === 'survey' && questions.length) {
    const current = progress
    return (
      <>
        <p className="mb-8 text-sm text-neutral-500">
          {studyName} · step 2 of 4
        </p>
        <Survey
          questions={questions}
          answers={current.answers ?? {}}
          onAnswer={(code: string, value: AnswerValue | undefined) => {
            const answers = { ...(current.answers ?? {}) }
            if (value === undefined) delete answers[code]
            else answers[code] = value
            save({ ...current, answers })
          }}
          onDone={() => submitSurvey(current)}
        />
      </>
    )
  }

  if (progress.step === 'survey' || progress.step === 'waiting') {
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

        {questions.length > 0 && (
          <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
            <p className="text-sm font-medium text-neutral-900">
              Your answers are in
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Thank you - the questions are done. All that is left is your file,
              and you decide what of it to share.
            </p>
          </div>
        )}

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

  if (progress.step === 'reconcile') {
    const current = progress
    return (
      <Reconcile
        studySlug={studySlug}
        sessionId={current.sessionId}
        onDone={() => save({ ...current, step: 'done' })}
      />
    )
  }

  if (progress.step === 'done') {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          You are all done
        </h1>
        <p className="mt-3 max-w-prose text-neutral-600">
          Thank you for taking part. You can ask us to delete everything you
          shared at any time.
        </p>
      </section>
    )
  }

  const current = progress
  return (
    <>
      <p className="mb-8 text-sm text-neutral-500">
        {studyName} · step {questions.length ? 3 : 2} of{' '}
        {questions.length ? 4 : 3}
      </p>
      <ReviewAndRelease
        studySlug={studySlug}
        sessionId={current.sessionId}
        window={studyWindow}
        allowedSources={sources}
        onContinue={() => save({ ...current, step: 'reconcile' })}
      />
    </>
  )
}
