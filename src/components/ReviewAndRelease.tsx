'use client'

/**
 * Review and release.
 *
 * The respondent picks their export, it is parsed here in the browser, and
 * they decide item by item what we may keep. Only released records leave the
 * device. See CLAUDE.md invariants 1 and 5.
 *
 * Used by both modes: on its own for a full-service study, and inside
 * /capture/release when the interview is running on someone else's platform.
 */

import { useCallback, useMemo, useState } from 'react'
import { readArchive, type IntakeReport } from '@/lib/parsers'
import {
  SOURCE_LABELS,
  type ReviewedRecord,
  type SourceKind,
} from '@/lib/records'

export interface ReturnTargets {
  /** Where to send the respondent after they release. */
  complete: string
  /** Where to send them if they choose not to share. Distinct on purpose. */
  declined: string
}

interface Props {
  studySlug: string
  respondentId?: string
  /**
   * Full-service only. Append mode joins on the referring platform's
   * respondent id instead, which arrives on both hops.
   */
  sessionId?: string
  window?: { from?: Date; to?: Date }
  /** Sources the respondent granted; anything else is dropped at parse time. */
  allowedSources?: SourceKind[]
  /** Absent in full-service mode, where we keep the respondent ourselves. */
  returnTo?: ReturnTargets
}

interface Receipt {
  releasedCount: number
  withheldCount: number
  answerCount?: number
  sources: string[]
  earliest: string | null
  latest: string | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Cited URLs are long and noisy; the domain is what a reader can judge. */
function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function ReviewAndRelease({
  studySlug,
  respondentId,
  sessionId,
  window: studyWindow,
  allowedSources,
  returnTo,
}: Props) {
  const [records, setRecords] = useState<ReviewedRecord[] | null>(null)
  const [report, setReport] = useState<IntakeReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const onPick = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      try {
        const result = await readArchive(file, studyWindow, allowedSources)
        setReport(result)
        setRecords(
          result.records.map((r) => ({
            ...r,
            withheld: false,
            withheldAnswer: false,
          }))
        )
      } finally {
        setBusy(false)
      }
    },
    [studyWindow, allowedSources]
  )

  const grouped = useMemo(() => {
    if (!records) return []
    const bySource = new Map<SourceKind, ReviewedRecord[]>()
    for (const record of records) {
      const list = bySource.get(record.source) ?? []
      list.push(record)
      bySource.set(record.source, list)
    }
    return [...bySource.entries()]
  }, [records])

  const kept = records?.filter((r) => !r.withheld) ?? []
  const releasedCount = kept.length
  const withheldCount = (records?.length ?? 0) - releasedCount
  const answersKept = kept.filter((r) => r.answer && !r.withheldAnswer).length
  const answersTotal = records?.filter((r) => r.answer).length ?? 0

  const toggle = (id: string) =>
    setRecords((prev) =>
      prev
        ? prev.map((r) => (r.id === id ? { ...r, withheld: !r.withheld } : r))
        : prev
    )

  const toggleAnswer = (id: string) =>
    setRecords((prev) =>
      prev
        ? prev.map((r) =>
            r.id === id ? { ...r, withheldAnswer: !r.withheldAnswer } : r
          )
        : prev
    )

  const setSourceWithheld = (source: SourceKind, withheld: boolean) =>
    setRecords((prev) =>
      prev
        ? prev.map((r) => (r.source === source ? { ...r, withheld } : r))
        : prev
    )

  const setAllAnswersWithheld = (withheld: boolean) =>
    setRecords((prev) =>
      prev
        ? prev.map((r) => (r.answer ? { ...r, withheldAnswer: withheld } : r))
        : prev
    )

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Strips anything the respondent held back. Runs before the request body. */
  const payloadFor = (list: ReviewedRecord[]) =>
    list
      .filter((r) => !r.withheld)
      .map(({ source, timestamp, text, context, answer, citations, withheldAnswer }) => ({
        source,
        timestamp,
        text,
        context,
        answer: withheldAnswer ? undefined : answer,
        citations: withheldAnswer ? undefined : citations,
      }))

  /**
   * A respondent who gets this far and says no is a valid, retained outcome,
   * not a failure. Record it before redirecting: a decline that only exists as
   * a redirect is invisible to us, and these sessions are the comparison group
   * that makes donation-selection bias measurable.
   */
  async function decline() {
    setBusy(true)
    try {
      await fetch('/api/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studySlug,
          respondentId,
          sessionId,
          withheldCount: records?.length ?? 0,
          records: [],
        }),
      })
    } catch {
      // Redirect regardless. Trapping someone on our screen because our own
      // write failed is the worse outcome; the referring platform still gets
      // `declined` in the return status.
    } finally {
      setBusy(false)
      if (returnTo) window.location.href = returnTo.declined
    }
  }

  async function release() {
    if (!records) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The session is resolved server-side from these, and is always
        // checked against the study, so neither key can reach another
        // study's fielding. There is no auth anywhere in this flow - a
        // respondent arrives from a link - so this identifies a row rather
        // than authorising anything.
        body: JSON.stringify({
          studySlug,
          respondentId,
          sessionId,
          withheldCount,
          records: payloadFor(records),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Something went wrong.')
        return
      }
      if (returnTo) {
        window.location.href = returnTo.complete
        return
      }
      setReceipt(data.receipt)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (receipt) {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Thank you. Here is exactly what you sent.
        </h1>
        <dl className="mt-8 divide-y divide-neutral-200 border-y border-neutral-200 text-sm">
          <div className="flex justify-between py-3">
            <dt className="text-neutral-600">Records released</dt>
            <dd className="font-medium tabular-nums">{receipt.releasedCount}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-neutral-600">Records you held back</dt>
            <dd className="font-medium tabular-nums">{receipt.withheldCount}</dd>
          </div>
          {answersTotal > 0 && (
            <div className="flex justify-between py-3">
              <dt className="text-neutral-600">AI answers included</dt>
              <dd className="font-medium tabular-nums">
                {receipt.answerCount ?? answersKept} of {answersTotal}
              </dd>
            </div>
          )}
          <div className="flex justify-between py-3">
            <dt className="text-neutral-600">Sources</dt>
            <dd className="font-medium">
              {receipt.sources
                .map((s) => SOURCE_LABELS[s as SourceKind] ?? s)
                .join(', ') || 'None'}
            </dd>
          </div>
          {receipt.earliest && receipt.latest && (
            <div className="flex justify-between py-3">
              <dt className="text-neutral-600">Period covered</dt>
              <dd className="font-medium">
                {formatDate(receipt.earliest)} to {formatDate(receipt.latest)}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-6 text-sm text-neutral-600">
          Records you held back were never sent. You can ask us to delete
          everything at any time.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">
        Review before you share
      </h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        Your file is opened on this device and nothing is sent until you press
        release. Anything you hold back stays here.
      </p>

      {!records && (
        <label className="mt-10 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 px-6 py-12 text-center transition hover:border-neutral-400">
          <span className="font-medium">Choose your export file</span>
          <span className="mt-1 text-sm text-neutral-500">
            The .zip you downloaded, or conversations.json
          </span>
          <input
            type="file"
            accept=".zip,.json,application/zip,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onPick(file)
            }}
          />
        </label>
      )}

      {busy && <p className="mt-6 text-sm text-neutral-500">Working…</p>}

      {report?.error && (
        <p className="mt-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {report.error}
        </p>
      )}

      {records && records.length > 0 && (
        <>
          <p className="mt-8 text-sm text-neutral-600">
            Found <strong className="tabular-nums">{records.length}</strong>{' '}
            items. Releasing{' '}
            <strong className="tabular-nums">{releasedCount}</strong>, holding
            back <strong className="tabular-nums">{withheldCount}</strong>.
          </p>

          {answersTotal > 0 && (
            <div className="mt-6 rounded-lg border border-neutral-900 bg-white p-5">
              <h2 className="font-medium">
                {answersTotal} of these include what the AI told you
              </h2>
              <p className="mt-1 max-w-prose text-sm text-neutral-600">
                These are the longest thing you would be sharing - full answers,
                sometimes several hundred words. Open any of them below to read
                what it says before you decide. You can share the question you
                asked while holding back the answer.
              </p>
              <p className="mt-3 text-sm">
                Currently sharing{' '}
                <strong className="tabular-nums">{answersKept}</strong> of{' '}
                <strong className="tabular-nums">{answersTotal}</strong> answers.
              </p>
              <div className="mt-3 flex gap-4 text-xs">
                <button
                  type="button"
                  className="text-neutral-500 underline hover:text-neutral-900"
                  onClick={() => setAllAnswersWithheld(true)}
                >
                  Hold back every answer
                </button>
                <button
                  type="button"
                  className="text-neutral-500 underline hover:text-neutral-900"
                  onClick={() => setAllAnswersWithheld(false)}
                >
                  Include every answer
                </button>
              </div>
            </div>
          )}

          {grouped.map(([source, items]) => (
            <div key={source} className="mt-8">
              <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  {SOURCE_LABELS[source]}{' '}
                  <span className="tabular-nums">({items.length})</span>
                </h2>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-neutral-500 underline hover:text-neutral-900"
                    onClick={() => setSourceWithheld(source, true)}
                  >
                    Hold back all
                  </button>
                  <button
                    type="button"
                    className="text-neutral-500 underline hover:text-neutral-900"
                    onClick={() => setSourceWithheld(source, false)}
                  >
                    Include all
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-neutral-100">
                {items.map((record) => {
                  const isOpen = expanded.has(record.id)
                  return (
                    <li key={record.id} className="py-2.5 text-sm">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!record.withheld}
                          onChange={() => toggle(record.id)}
                          aria-label={`Include: ${record.text.slice(0, 60)}`}
                        />
                        <span className="flex-1">
                          <span
                            className={
                              record.withheld
                                ? 'text-neutral-400 line-through'
                                : undefined
                            }
                          >
                            {record.text}
                          </span>
                          <span className="mt-0.5 block text-xs text-neutral-400">
                            {formatDate(record.timestamp)}
                            {record.context ? ` · ${record.context}` : ''}
                          </span>
                        </span>
                      </div>

                      {record.answer && !record.withheld && (
                        <div className="ml-7 mt-2 rounded-md border border-neutral-200 bg-neutral-50">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                            <span className="text-xs font-medium text-neutral-700">
                              The AI answered ·{' '}
                              <span className="tabular-nums">
                                {wordCount(record.answer)}
                              </span>{' '}
                              words
                              {record.citations?.length
                                ? ` · ${record.citations.length} source${
                                    record.citations.length === 1 ? '' : 's'
                                  }`
                                : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleExpanded(record.id)}
                              className="text-xs text-neutral-600 underline hover:text-neutral-900"
                            >
                              {isOpen ? 'Hide' : 'Read it'}
                            </button>
                            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-neutral-700">
                              <input
                                type="checkbox"
                                checked={!record.withheldAnswer}
                                onChange={() => toggleAnswer(record.id)}
                              />
                              Share this answer
                            </label>
                          </div>

                          {isOpen && (
                            <div className="border-t border-neutral-200 px-3 py-3">
                              {/*
                                Expands in the page flow rather than inside its
                                own scroll box. A nested scroller on a phone
                                traps the page scroll and is where someone stops
                                reading - which would defeat the reason the
                                answer is shown at all. Collapsed by default is
                                what keeps a long list manageable.
                              */}
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                                {record.answer}
                              </p>
                              {record.citations?.length ? (
                                <p className="mt-3 border-t border-neutral-200 pt-2 text-xs text-neutral-500">
                                  Sources it cited:{' '}
                                  {[
                                    ...new Set(record.citations.map(domainOf)),
                                  ].join(', ')}
                                </p>
                              ) : null}
                            </div>
                          )}

                          {record.withheldAnswer && (
                            <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                              Held back. We will receive your question but not
                              this answer.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {error && (
            <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void release()}
              className="rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
            >
              Release {releasedCount} items
              {answersTotal > 0 ? ` and ${answersKept} answers` : ''}
            </button>
            {returnTo && (
              <button
                type="button"
                onClick={() => void decline()}
                className="text-sm text-neutral-500 underline hover:text-neutral-900"
              >
                I would rather not share this
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
