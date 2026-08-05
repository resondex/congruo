'use client'

/**
 * The last step: putting the divergences back to the respondent.
 *
 * This is the only place in the flow where someone sees their own answers and
 * their own records together, and it happens after both are locked. Nothing
 * here edits a survey answer - the self-report was given before they had seen
 * a record, which is the whole reason it is worth anything.
 *
 * The tone is load-bearing. A divergence is the difference between a claim and
 * the subset of records they chose to release, over whatever period their
 * archive covers. We are not in a position to tell anyone they misremembered,
 * and the interesting answer is usually that the question and the record were
 * never measuring the same thing.
 */

import { useEffect, useState } from 'react'
import {
  EXPLANATIONS,
  MAX_NOTE,
  type Caveat,
  type Comparison,
  type Explanation,
} from '@/lib/reconcile'

interface Props {
  studySlug: string
  sessionId?: string
  onDone: () => void
}

interface Given {
  explanation?: Explanation
  note?: string
}

const CAVEAT_TEXT: Record<Caveat, string> = {
  records_withheld:
    'You held some records back, so what we can see here is only part of the picture.',
  short_coverage:
    'Your file covers a shorter period than the question asked about.',
  source_absent: 'Nothing was shared for the service this question is about.',
}

export default function Reconcile({ studySlug, sessionId, onDone }: Props) {
  const [comparisons, setComparisons] = useState<Comparison[] | null>(null)
  const [given, setGiven] = useState<Record<string, Given>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!sessionId) {
        setComparisons([])
        return
      }
      try {
        const response = await fetch('/api/reconcile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ studySlug, sessionId }),
        })
        const data = await response.json()
        if (!cancelled) setComparisons(data.comparisons ?? [])
      } catch {
        if (!cancelled) setComparisons([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [studySlug, sessionId])

  if (comparisons === null) {
    return <p className="text-sm text-neutral-500">One moment…</p>
  }

  const diverging = comparisons.filter((c) => !c.agrees)
  const matching = comparisons.filter((c) => c.agrees)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studySlug,
          sessionId,
          action: 'respond',
          responses: diverging.map((c) => ({
            questionCode: c.questionCode,
            explanation: given[c.questionCode]?.explanation,
            note: given[c.questionCode]?.note,
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not save that.')
        return
      }
      setSaved(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (saved || !diverging.length) {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          That is everything. Thank you.
        </h1>
        <p className="mt-3 max-w-prose text-neutral-600">
          {saved
            ? 'Your answers are recorded alongside what you shared.'
            : matching.length
              ? 'What you told us and what your history shows line up.'
              : 'Nothing further to go through.'}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-8 rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white"
        >
          Finish
        </button>
      </section>
    )
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">
        A few things did not line up
      </h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        This is usually us, not you - we can only see what you chose to share,
        and a question can mean something different to the person answering it
        than to the record. Tell us which it was.
      </p>

      <div className="mt-10 space-y-10">
        {diverging.map((comparison) => (
          <div
            key={comparison.questionCode}
            className="rounded-lg border border-neutral-200 p-5"
          >
            <p className="font-medium">{comparison.prompt}</p>

            {/* Side by side is the comparison; on a narrow screen it becomes
                two wrapping columns of three words, so stack instead. */}
            <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  You said
                </dt>
                <dd className="mt-1 font-medium">{comparison.claimed}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  What you shared shows
                </dt>
                <dd className="mt-1 font-medium">{comparison.observed}</dd>
              </div>
            </dl>

            {comparison.caveats.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-neutral-100 pt-3">
                {comparison.caveats.map((caveat) => (
                  <li key={caveat} className="text-xs text-neutral-500">
                    {CAVEAT_TEXT[caveat]}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 space-y-2">
              {EXPLANATIONS.map((option) => {
                const chosen =
                  given[comparison.questionCode]?.explanation === option.value
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-2.5 text-sm transition ${
                      chosen
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 hover:border-neutral-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name={comparison.questionCode}
                      checked={chosen}
                      onChange={() =>
                        setGiven((prev) => ({
                          ...prev,
                          [comparison.questionCode]: {
                            ...prev[comparison.questionCode],
                            explanation: option.value,
                          },
                        }))
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>

            <textarea
              rows={2}
              maxLength={MAX_NOTE}
              placeholder="Anything you want to add (optional)"
              value={given[comparison.questionCode]?.note ?? ''}
              onChange={(event) =>
                setGiven((prev) => ({
                  ...prev,
                  [comparison.questionCode]: {
                    ...prev[comparison.questionCode],
                    note: event.target.value,
                  },
                }))
              }
              className="mt-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </div>
        ))}
      </div>

      {matching.length > 0 && (
        <p className="mt-8 text-sm text-neutral-500">
          The other{' '}
          <strong className="tabular-nums">{matching.length}</strong>{' '}
          {matching.length === 1 ? 'answer' : 'answers'} matched what your
          history shows.
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Done'}
        </button>
        {/*
          Every explanation here is optional. Someone who does not know why the
          two disagree - which is a perfectly common state - should not be held
          on this screen until they invent a reason.
        */}
        <button
          type="button"
          onClick={onDone}
          className="text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Skip this
        </button>
      </div>
    </section>
  )
}
