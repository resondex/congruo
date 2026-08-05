'use client'

/**
 * Review and release.
 *
 * The respondent picks their export, it is parsed here in the browser, and
 * they decide what we may keep. Only released records leave the device. See
 * CLAUDE.md invariants 1 and 5.
 *
 * Structured around the fact that a real archive is thousands of records. A
 * flat checkbox list is not review - nobody reads 3,573 rows, and a screen
 * that implies they did is worse than one that admits they did not. So the
 * unit of decision is the source: how many, over what period, in or out. Under
 * that sits a search box that acts on everything it matches, which is the only
 * redaction tool that works at this size, and under that the individual
 * records, always reachable and never the thing you must get through.
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
   * respondent id, which arrives on both hops.
   */
  sessionId?: string
  window?: { from?: Date; to?: Date }
  /** Sources the respondent granted; anything else is dropped at parse time. */
  allowedSources?: SourceKind[]
  /** Absent in full-service mode, where we keep the respondent ourselves. */
  returnTo?: ReturnTargets
  /**
   * Offered on the receipt in full-service mode, to carry on to reconcile.
   * Append studies have no next step here - they are handed back instead.
   */
  onContinue?: () => void
}

interface Receipt {
  releasedCount: number
  withheldCount: number
  answerCount?: number
  sources: string[]
  earliest: string | null
  latest: string | null
}

/** How many records a source shows before asking to show more. */
const PAGE = 50

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

const matches = (record: ReviewedRecord, term: string) => {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return (
    record.text.toLowerCase().includes(needle) ||
    (record.context?.toLowerCase().includes(needle) ?? false) ||
    // Searching answers too: someone redacting "insurance" means the topic,
    // and the topic is often only named in what the AI said back.
    (record.answer?.toLowerCase().includes(needle) ?? false)
  )
}

export default function ReviewAndRelease({
  studySlug,
  respondentId,
  sessionId,
  window: studyWindow,
  allowedSources,
  returnTo,
  onContinue,
}: Props) {
  const [records, setRecords] = useState<ReviewedRecord[] | null>(null)
  const [report, setReport] = useState<IntakeReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [openSources, setOpenSources] = useState<Set<SourceKind>>(new Set())
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [openAnswers, setOpenAnswers] = useState<Set<string>>(new Set())

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

  /**
   * Records are already newest-first from the parser, so the first and last of
   * a group are its date range without scanning.
   */
  const groups = useMemo(() => {
    if (!records) return []
    const bySource = new Map<SourceKind, ReviewedRecord[]>()
    for (const record of records) {
      const list = bySource.get(record.source) ?? []
      list.push(record)
      bySource.set(record.source, list)
    }
    return [...bySource.entries()].map(([source, items]) => ({
      source,
      items,
      kept: items.filter((r) => !r.withheld).length,
      answers: items.filter((r) => r.answer).length,
      answersKept: items.filter((r) => r.answer && !r.withheldAnswer && !r.withheld)
        .length,
      latest: items[0]?.timestamp,
      earliest: items[items.length - 1]?.timestamp,
    }))
  }, [records])

  const kept = records?.filter((r) => !r.withheld) ?? []
  const releasedCount = kept.length
  const withheldCount = (records?.length ?? 0) - releasedCount
  const answersKept = kept.filter((r) => r.answer && !r.withheldAnswer).length
  const answersTotal = records?.filter((r) => r.answer).length ?? 0

  const update = (
    predicate: (r: ReviewedRecord) => boolean,
    change: (r: ReviewedRecord) => ReviewedRecord
  ) =>
    setRecords((prev) =>
      prev ? prev.map((r) => (predicate(r) ? change(r) : r)) : prev
    )

  const toggle = (id: string) =>
    update(
      (r) => r.id === id,
      (r) => ({ ...r, withheld: !r.withheld })
    )

  const toggleAnswer = (id: string) =>
    update(
      (r) => r.id === id,
      (r) => ({ ...r, withheldAnswer: !r.withheldAnswer })
    )

  const setWithheld = (
    predicate: (r: ReviewedRecord) => boolean,
    withheld: boolean
  ) => update(predicate, (r) => ({ ...r, withheld }))

  const setAllAnswersWithheld = (withheld: boolean) =>
    update(
      (r) => !!r.answer,
      (r) => ({ ...r, withheldAnswer: withheld })
    )

  const toggleOpen = (source: SourceKind) =>
    setOpenSources((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })

  const toggleOpenAnswer = (id: string) =>
    setOpenAnswers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Strips anything the respondent held back. Runs before the request body. */
  const payloadFor = (list: ReviewedRecord[]) =>
    list
      .filter((r) => !r.withheld)
      .map(
        ({ source, timestamp, text, context, answer, citations, withheldAnswer }) => ({
          source,
          timestamp,
          text,
          context,
          answer: withheldAnswer ? undefined : answer,
          citations: withheldAnswer ? undefined : citations,
        })
      )

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
        // study's fielding.
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
            <dd className="font-medium tabular-nums">
              {receipt.releasedCount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-neutral-600">Records you held back</dt>
            <dd className="font-medium tabular-nums">
              {receipt.withheldCount.toLocaleString()}
            </dd>
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
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="mt-8 rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white"
          >
            One last thing
          </button>
        )}
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
          <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
            <p className="text-sm text-neutral-700">
              Your file holds{' '}
              <strong className="tabular-nums">
                {records.length.toLocaleString()}
              </strong>{' '}
              items across{' '}
              <strong className="tabular-nums">{groups.length}</strong>{' '}
              {groups.length === 1 ? 'kind' : 'kinds'} of activity.
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Sending{' '}
              <strong className="tabular-nums">
                {releasedCount.toLocaleString()}
              </strong>
              , holding back{' '}
              <strong className="tabular-nums">
                {withheldCount.toLocaleString()}
              </strong>
              . Decide a whole kind at once, search within it, or open it up and
              go item by item.
            </p>
          </div>

          {answersTotal > 0 && (
            <div className="mt-6 rounded-lg border border-neutral-900 bg-white p-5">
              <h2 className="font-medium">
                {answersTotal} of these include what the AI told you
              </h2>
              <p className="mt-1 max-w-prose text-sm text-neutral-600">
                These are the longest thing you would be sharing - full answers,
                sometimes several hundred words. You can share the question you
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

          <div className="mt-8 space-y-4">
            {groups.map((group) => {
              const isOpen = openSources.has(group.source)
              const filter = filters[group.source] ?? ''
              const limit = limits[group.source] ?? PAGE
              const filtered = filter
                ? group.items.filter((r) => matches(r, filter))
                : group.items
              const shown = filtered.slice(0, limit)
              const allOut = group.kept === 0
              const someOut = group.kept < group.items.length

              return (
                <div
                  key={group.source}
                  className={`rounded-lg border transition ${
                    allOut ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-300'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-medium">
                          {SOURCE_LABELS[group.source]}
                        </h2>
                        <p className="mt-1 text-sm text-neutral-600">
                          <span className="tabular-nums">
                            {group.items.length.toLocaleString()}
                          </span>{' '}
                          {group.items.length === 1 ? 'item' : 'items'}
                          {group.earliest && group.latest && (
                            <>
                              {' · '}
                              {formatDate(group.earliest)} to{' '}
                              {formatDate(group.latest)}
                            </>
                          )}
                          {group.answers > 0 && (
                            <>
                              {' · '}
                              <span className="tabular-nums">
                                {group.answers}
                              </span>{' '}
                              with AI answers
                            </>
                          )}
                        </p>
                        {someOut && (
                          <p className="mt-1 text-sm font-medium text-neutral-900">
                            {allOut ? (
                              'Holding all of these back'
                            ) : (
                              <>
                                Sending{' '}
                                <span className="tabular-nums">
                                  {group.kept.toLocaleString()}
                                </span>{' '}
                                of{' '}
                                <span className="tabular-nums">
                                  {group.items.length.toLocaleString()}
                                </span>
                              </>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setWithheld((r) => r.source === group.source, allOut)
                          }
                          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                            allOut
                              ? 'border-neutral-300 hover:border-neutral-500'
                              : 'border-neutral-900 bg-neutral-900 text-white'
                          }`}
                        >
                          {allOut ? 'Include these' : 'Sending'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWithheld((r) => r.source === group.source, true)
                          }
                          disabled={allOut}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:border-neutral-500 disabled:opacity-30"
                        >
                          Hold back
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleOpen(group.source)}
                      className="mt-3 text-sm text-neutral-600 underline hover:text-neutral-900"
                    >
                      {isOpen
                        ? 'Hide these'
                        : `Search or go through ${
                            group.items.length === 1 ? 'it' : 'them'
                          } one by one`}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-neutral-200 p-5">
                      <input
                        type="search"
                        value={filter}
                        placeholder={`Search these ${group.items.length.toLocaleString()} items`}
                        onChange={(event) =>
                          setFilters((prev) => ({
                            ...prev,
                            [group.source]: event.target.value,
                          }))
                        }
                        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
                      />

                      {/*
                        Acting on everything a search matches is the only
                        redaction that works at this size. Going item by item
                        through four thousand rows is not something anyone will
                        do, and a screen that only offers that is really
                        offering nothing.
                      */}
                      {filter.trim() && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
                          <span className="text-neutral-600">
                            <strong className="tabular-nums">
                              {filtered.length.toLocaleString()}
                            </strong>{' '}
                            {filtered.length === 1 ? 'match' : 'matches'}
                          </span>
                          {filtered.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setWithheld(
                                    (r) =>
                                      r.source === group.source &&
                                      matches(r, filter),
                                    true
                                  )
                                }
                                className="ml-auto rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:border-neutral-500"
                              >
                                Hold back all matches
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setWithheld(
                                    (r) =>
                                      r.source === group.source &&
                                      matches(r, filter),
                                    false
                                  )
                                }
                                className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:border-neutral-500"
                              >
                                Include all matches
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {filtered.length === 0 ? (
                        <p className="mt-4 text-sm text-neutral-500">
                          Nothing here matches that.
                        </p>
                      ) : (
                        <>
                          <ul className="mt-2 divide-y divide-neutral-100">
                            {shown.map((record) => {
                              const answerOpen = openAnswers.has(record.id)
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
                                                record.citations.length === 1
                                                  ? ''
                                                  : 's'
                                              }`
                                            : ''}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => toggleOpenAnswer(record.id)}
                                          className="text-xs text-neutral-600 underline hover:text-neutral-900"
                                        >
                                          {answerOpen ? 'Hide' : 'Read it'}
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

                                      {answerOpen && (
                                        <div className="border-t border-neutral-200 px-3 py-3">
                                          {/*
                                            Expands in the page flow rather than
                                            inside its own scroll box. A nested
                                            scroller on a phone traps the page
                                            scroll and is where someone stops
                                            reading - which would defeat the
                                            reason the answer is shown at all.
                                          */}
                                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                                            {record.answer}
                                          </p>
                                          {record.citations?.length ? (
                                            <p className="mt-3 border-t border-neutral-200 pt-2 text-xs text-neutral-500">
                                              Sources it cited:{' '}
                                              {[
                                                ...new Set(
                                                  record.citations.map(domainOf)
                                                ),
                                              ].join(', ')}
                                            </p>
                                          ) : null}
                                        </div>
                                      )}

                                      {record.withheldAnswer && (
                                        <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500">
                                          Held back. We will receive your question
                                          but not this answer.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </li>
                              )
                            })}
                          </ul>

                          {filtered.length > shown.length && (
                            <button
                              type="button"
                              onClick={() =>
                                setLimits((prev) => ({
                                  ...prev,
                                  [group.source]: limit + PAGE,
                                }))
                              }
                              className="mt-4 w-full rounded-md border border-neutral-300 py-2 text-sm hover:border-neutral-500"
                            >
                              Show {Math.min(PAGE, filtered.length - shown.length)}{' '}
                              more of{' '}
                              <span className="tabular-nums">
                                {(filtered.length - shown.length).toLocaleString()}
                              </span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

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
              Release {releasedCount.toLocaleString()} items
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
