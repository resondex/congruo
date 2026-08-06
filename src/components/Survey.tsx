'use client'

/**
 * The survey, one page at a time.
 *
 * This runs while the respondent's export is being prepared and must finish
 * before they see any of their own records (invariant 2). Nothing on this
 * screen may reference what we hold - a question that reacted to the archive
 * would contaminate the self-report it exists to capture.
 *
 * Answers are held by the caller so they survive a closed tab. Exports take
 * minutes to hours and respondents do leave mid-instrument.
 */

import { useState } from 'react'
import {
  groupIntoPages,
  pageIsComplete,
  scalePoints,
  terminatedBy,
  validateAnswer,
  answerKey,
  displayRange,
  isAnswerable,
  MAX_TEXT_ANSWER,
  OTHER_CODE,
  PREFER_NOT_CODE,
  type AnswerValue,
  type Answers,
  type Question,
  type QuestionOption,
} from '@/lib/survey'

interface Props {
  questions: Question[]
  answers: Answers
  onAnswer: (code: string, value: AnswerValue | undefined) => void
  onDone: () => Promise<string | null>
}

export default function Survey({ questions, answers, onAnswer, onDone }: Props) {
  // Recomputed every render: answering a question can open or close a branch,
  // and the page after this one is not knowable until the current one is done.
  const pages = groupIntoPages(questions, answers)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Problems stay hidden until Continue is pressed. Telling someone their
  // answer is wrong before they have finished giving it is just nagging.
  const [showProblems, setShowProblems] = useState(false)

  // Changing an earlier answer can close a branch and shorten the interview
  // out from under the current position, so clamp rather than render nothing.
  const at = Math.min(index, pages.length - 1)
  const page = pages[at]
  if (!page) return null

  const isLast = at === pages.length - 1
  const complete = pageIsComplete(page, answers)

  async function submit() {
    setBusy(true)
    setError(null)
    const problem = await onDone()
    setBusy(false)
    if (problem) setError(problem)
  }

  async function next() {
    if (!complete) {
      setShowProblems(true)
      return
    }
    setShowProblems(false)

    // Screening happens as soon as the answer that decides it has been given,
    // not at the end. Walking someone through the rest of an interview they
    // have already failed to qualify for wastes their time and buys nothing -
    // the answers so far are submitted either way, because they are what the
    // incidence rate is calculated from. The server re-evaluates the same
    // rules and is what actually marks the session.
    if (terminatedBy(questions, answers)) {
      await submit()
      return
    }

    if (!isLast) {
      setIndex(at + 1)
      window.scrollTo({ top: 0 })
      return
    }
    await submit()
  }

  return (
    <section>
      <div className="flex items-center gap-3">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={at + 1}
          aria-valuemin={1}
          aria-valuemax={pages.length}
        >
          <div
            className="h-full bg-neutral-900 transition-all"
            style={{ width: `${((at + 1) / pages.length) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {at + 1} of {pages.length}
        </span>
      </div>

      <div className="mt-10 space-y-12">
        {page.questions.map((question) => (
          <QuestionField
            key={question.code}
            question={question}
            answer={answers[question.code]}
            rowAnswers={answers}
            onAnswer={(value, rowCode) =>
              onAnswer(answerKey(question.code, rowCode), value)
            }
            problem={
              showProblems
                ? validateAnswer(question, answers[question.code])
                : null
            }
          />
        ))}
      </div>

      {error && (
        <p className="mt-8 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <div className="mt-12 flex items-center gap-5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void next()}
          className="rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : isLast ? 'Finish' : 'Continue'}
        </button>
        {at > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowProblems(false)
              setIndex(at - 1)
            }}
            className="text-sm text-neutral-500 underline hover:text-neutral-900"
          >
            Back
          </button>
        )}
      </div>
    </section>
  )
}

function QuestionField({
  question,
  answer,
  rowAnswers,
  onAnswer,
  problem,
}: {
  question: Question
  answer: AnswerValue | undefined
  /** Every answer, so a matrix can find its own rows. */
  rowAnswers?: Answers
  onAnswer: (value: AnswerValue | undefined, rowCode?: number) => void
  problem: string | null
}) {
  // Shown, not asked. No legend, no "optional", nothing to get wrong - a
  // heading wrapped in a fieldset reads to a screen reader as a question with
  // no answers, which is worse than no markup at all.
  if (!isAnswerable(question.type)) {
    switch (question.type) {
      case 'section':
        return (
          <div className="border-b border-neutral-200 pb-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {question.prompt}
            </h2>
            {question.help && (
              <p className="mt-1 max-w-prose text-sm text-neutral-600">
                {question.help}
              </p>
            )}
          </div>
        )
      case 'description':
        return (
          <div className="max-w-prose whitespace-pre-wrap text-neutral-700">
            {question.prompt}
          </div>
        )
      case 'media':
        return (
          <figure>
            {/* Author-supplied URL, so plain img: next/image wants a known
                host list and this one is configured per study. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={question.mediaUrl}
              alt={question.mediaAlt ?? ''}
              className="max-w-full rounded-lg border border-neutral-200"
            />
            {question.prompt && (
              <figcaption className="mt-2 text-sm text-neutral-600">
                {question.prompt}
              </figcaption>
            )}
          </figure>
        )
      case 'terminal':
        // Reaching one ends the interview, which the flow handles. If it is
        // ever rendered, say something rather than showing a blank.
        return (
          <p className="max-w-prose text-neutral-700">
            {question.prompt || 'Thank you - that is everything we needed.'}
          </p>
        )
      default:
        return null
    }
  }

  return (
    <fieldset>
      <legend className="text-lg font-medium tracking-tight">
        {question.prompt}
        {!question.required && (
          <span className="ml-2 align-middle text-xs font-normal text-neutral-400">
            optional
          </span>
        )}
      </legend>
      {question.help && (
        <p className="mt-1 text-sm text-neutral-500">{question.help}</p>
      )}

      <div className="mt-5">
        {question.matrixRows?.length ? (
          /*
            One row at a time, stacked. A grid on a phone means horizontal
            scrolling or type too small to read, and the stored answers are the
            same either way - which is the whole reason a matrix is a modifier
            rather than a type.
          */
          <div className="space-y-5">
            {question.matrixRows.map((row) => (
              <div key={row.code} className="rounded-lg border border-neutral-200 p-4">
                <p className="text-sm font-medium">{row.label}</p>
                <div className="mt-3">
                  <Field
                    question={question}
                    answer={rowAnswers?.[answerKey(question.code, row.code)]}
                    onAnswer={(value) => onAnswer(value, row.code)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Field question={question} answer={answer} onAnswer={onAnswer} />
        )}
      </div>

      {problem && <p className="mt-3 text-sm text-red-700">{problem}</p>}
    </fieldset>
  )
}

/** Generous hit areas throughout: this is answered one-handed on a phone. */
function Field({
  question,
  answer,
  onAnswer,
}: {
  question: Question
  answer: AnswerValue | undefined
  onAnswer: (value: AnswerValue | undefined) => void
}) {
  // "Other" and "Prefer not to say" are appended rather than authored, so their
  // codes mean the same thing in every study and a delivered file reads the
  // same way across them.
  const offered: QuestionOption[] = [
    ...question.options,
    ...(question.allowOther
      ? [{ code: OTHER_CODE, label: 'Other, please specify' }]
      : []),
    ...(question.allowPreferNotToSay
      ? [{ code: PREFER_NOT_CODE, label: 'Prefer not to say' }]
      : []),
  ]
  const chosen = answer?.kind === 'codes' ? answer.codes : []
  const otherText = answer?.kind === 'codes' ? (answer.text ?? '') : ''

  const setCodes = (codes: number[], text?: string) =>
    codes.length || text
      ? onAnswer({ kind: 'codes', codes, text })
      : onAnswer(undefined)

  switch (question.type) {
    case 'single':
    case 'multiple': {
      const single = question.type === 'single'

      // Same answer, drawn for a long list rather than a short one.
      if (single && question.display === 'dropdown') {
        return (
          <select
            value={chosen[0] ?? ''}
            onChange={(e) =>
              setCodes(e.target.value ? [Number(e.target.value)] : [])
            }
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Choose one</option>
            {offered.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        )
      }

      return (
        <div className="space-y-2">
          {offered.map((option) => {
            const isChosen = chosen.includes(option.code)
            return (
              <label
                key={option.code}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                  isChosen
                    ? 'border-neutral-900 bg-neutral-50'
                    : 'border-neutral-200 hover:border-neutral-400'
                }`}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={question.code}
                  checked={isChosen}
                  onChange={() => {
                    if (single) {
                      return setCodes([option.code], otherText || undefined)
                    }
                    // Exclusive options clear the rest and are cleared by
                    // them: "none of these" alongside three services is not a
                    // mistake worth keeping and then having to code.
                    const exclusive = (c: number) =>
                      c === PREFER_NOT_CODE ||
                      offered.find((o) => o.code === c)?.exclusive
                    let next: number[]
                    if (isChosen) next = chosen.filter((c) => c !== option.code)
                    else if (exclusive(option.code)) next = [option.code]
                    else next = [...chosen.filter((c) => !exclusive(c)), option.code]
                    setCodes(next, otherText || undefined)
                  }}
                />
                <span>{option.label}</span>
              </label>
            )
          })}

          {chosen.includes(OTHER_CODE) && (
            <input
              type="text"
              value={otherText}
              placeholder="Tell us what"
              onChange={(e) => setCodes(chosen, e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          )}

          {question.maxSelections && !single && (
            <p className="text-xs text-neutral-500">
              Choose up to {question.maxSelections}.
            </p>
          )}
        </div>
      )
    }

    case 'polar': {
      // Two poles side by side. The same construct as a polar battery in a
      // segmentation spec, so a study can feed one without a recode.
      const picked = answer?.kind === 'codes' ? answer.codes[0] : null
      const [left, right] = question.options
      return (
        <div className="grid grid-cols-2 gap-3">
          {[left, right].filter(Boolean).map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => onAnswer({ kind: 'codes', codes: [option.code] })}
              className={`rounded-lg border px-4 py-6 text-sm transition ${
                picked === option.code
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 hover:border-neutral-400'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )
    }

    case 'overlap': {
      /**
       * Two circles the respondent slides together. Apart is -100, fully
       * overlapping is +100, and touching is 0.
       *
       * A continuous form of the Inclusion of Other in the Self scale, which
       * has been used since 1992 with seven fixed pictures - worth knowing,
       * because it means this measure has literature behind it rather than
       * being a novelty.
       */
      const given = answer?.kind === 'number'
      const at = given ? answer.value : 0
      // -100 fully apart, +100 concentric.
      const shift = 50 - (at + 100) / 4
      return (
        <div>
          {/*
            Until it is touched, the control shows a position it has not
            recorded. Left looking normal it reads as answered, and the
            respondent is then refused with no visible reason - so say so, and
            do not invent a value on their behalf.
          */}
          <div
            className={`relative mx-auto h-40 w-full max-w-sm transition-opacity ${
              given ? '' : 'opacity-40'
            }`}
          >
            <div
              className="absolute top-1/2 flex h-32 w-32 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 border-neutral-400 bg-neutral-100 text-center text-xs"
              style={{ left: '50%', marginLeft: '-4rem' }}
            >
              {question.staticImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={question.staticImage}
                  alt={question.staticLabel ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="px-2">{question.staticLabel}</span>
              )}
            </div>
            <div
              className="absolute top-1/2 flex h-32 w-32 -translate-y-1/2 items-center justify-center rounded-full border-2 border-neutral-900 bg-white/80 text-center text-xs font-medium transition-all"
              style={{ left: `calc(50% + ${shift}% )`, marginLeft: '-4rem' }}
            >
              <span className="px-2">{question.movingLabel}</span>
            </div>
          </div>
          <input
            type="range"
            min={-100}
            max={100}
            value={at}
            onChange={(e) =>
              onAnswer({ kind: 'number', value: Number(e.target.value) })
            }
            className="mt-2 w-full"
          />
          <div className="flex justify-between text-xs text-neutral-500">
            <span>Completely separate</span>
            <span>Completely overlapping</span>
          </div>
          {!given && (
            <p className="mt-2 text-sm text-neutral-500">
              Move the slider to answer.
            </p>
          )}
        </div>
      )
    }

    case 'scale': {
      const fixed = displayRange(question.display)
      const bounded = fixed
        ? { ...question, min: fixed.min, max: fixed.max }
        : question
      const points = scalePoints(bounded)
      const chosen = answer?.kind === 'number' ? answer.value : null
      const pick = (value: number) => onAnswer({ kind: 'number', value })

      // A slider or a thermometer over a wide range: a hundred buttons is not
      // a scale, it is a wall.
      if (question.display === 'slider' || question.display === 'thermometer') {
        const lo = bounded.min ?? 0
        const hi = bounded.max ?? 100
        return (
          <div>
            <input
              type="range"
              min={lo}
              max={hi}
              value={chosen ?? Math.round((lo + hi) / 2)}
              onChange={(e) => pick(Number(e.target.value))}
              className={`w-full ${chosen === null ? 'opacity-40' : ''}`}
            />
            <div className="flex justify-between text-xs text-neutral-500">
              <span>{question.minLabel ?? lo}</span>
              <span className="font-medium tabular-nums text-neutral-900">
                {chosen ?? 'move to answer'}
              </span>
              <span>{question.maxLabel ?? hi}</span>
            </div>
          </div>
        )
      }

      const SYMBOLS: Record<string, string[]> = {
        stars: ['★'],
        hearts: ['♥'],
        thumbs: ['👎', '👍'],
        smiley: ['😞', '🙁', '😐', '🙂', '😄'],
      }
      const symbols = question.display ? SYMBOLS[question.display] : undefined

      if (symbols) {
        return (
          <div>
            <div className="flex flex-wrap gap-2">
              {points.map((point, i) => {
                // A run of one symbol fills up to the chosen point, the way a
                // star rating reads. A set of distinct faces does not.
                const cumulative = symbols.length === 1
                const on = cumulative
                  ? chosen !== null && point <= chosen
                  : chosen === point
                const glyph =
                  symbols.length === 1
                    ? symbols[0]
                    : symbols[Math.floor((i / points.length) * symbols.length)]
                return (
                  <button
                    key={point}
                    type="button"
                    onClick={() => pick(point)}
                    aria-label={question.pointLabels?.[i] ?? String(point)}
                    aria-pressed={chosen === point}
                    className={`h-12 w-12 rounded-md border text-xl transition ${
                      on
                        ? 'border-neutral-900 bg-neutral-50'
                        : 'border-neutral-200 opacity-40 hover:opacity-100'
                    }`}
                  >
                    {glyph}
                  </button>
                )
              })}
            </div>
            {chosen !== null && question.pointLabels?.[points.indexOf(chosen)] && (
              <p className="mt-2 text-sm text-neutral-600">
                {question.pointLabels[points.indexOf(chosen)]}
              </p>
            )}
          </div>
        )
      }

      return (
        <div>
          <div className="flex gap-1.5">
            {points.map((point) => (
              <button
                key={point}
                type="button"
                onClick={() => pick(point)}
                aria-pressed={chosen === point}
                className={`h-12 flex-1 rounded-md border text-sm tabular-nums transition ${
                  chosen === point
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-200 hover:border-neutral-400'
                }`}
              >
                {point}
              </button>
            ))}
          </div>
          {question.pointLabels?.length ? (
            // Every point named. The labels are the author's to change; the
            // numbers under them are the data and are not.
            <div className="mt-2 grid gap-1 text-xs text-neutral-600" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
              {points.map((point, i) => (
                <span key={point} className="text-center leading-tight">
                  {question.pointLabels?.[i] ?? ''}
                </span>
              ))}
            </div>
          ) : (
            (question.minLabel || question.maxLabel) && (
              <div className="mt-2 flex justify-between text-xs text-neutral-500">
                <span>{question.minLabel}</span>
                <span>{question.maxLabel}</span>
              </div>
            )
          )}
        </div>
      )
    }

    case 'number':
      return (
        <input
          type="number"
          inputMode="numeric"
          min={question.min}
          max={question.max}
          value={answer?.kind === 'number' ? answer.value : ''}
          onChange={(event) => {
            const raw = event.target.value
            // An empty box is unanswered, not zero. Coercing it would record a
            // confident "never" from someone who simply had not typed yet.
            if (raw === '') return onAnswer(undefined)
            const parsed = Number(raw)
            onAnswer(
              Number.isFinite(parsed) ? { kind: 'number', value: parsed } : undefined
            )
          }}
          className="w-40 rounded-lg border border-neutral-300 px-4 py-3 text-lg tabular-nums focus:border-neutral-900 focus:outline-none"
        />
      )

    case 'date': {
      const value = answer?.kind === 'date' ? answer.value : ''
      return (
        <input
          type="date"
          // No future dates: the question always asks about something that has
          // already happened, and the picker should say so rather than the
          // validator.
          max={new Date().toISOString().slice(0, 10)}
          value={value}
          onChange={(e) =>
            onAnswer(e.target.value ? { kind: 'date', value: e.target.value } : undefined)
          }
          className="rounded-lg border border-neutral-300 px-4 py-3 focus:border-neutral-900 focus:outline-none"
        />
      )
    }

    case 'ranking': {
      const order = answer?.kind === 'order' ? answer.codes : []
      const unranked = question.options.filter((o) => !order.includes(o.code))
      const wanted = question.maxSelections ?? question.options.length

      /**
       * Tap to rank, tap again to unrank. Not drag and drop: dragging on a
       * touch screen fights the page scroll, and this is answered on a phone.
       */
      return (
        <div className="space-y-3">
          {order.length > 0 && (
            <ol className="space-y-2">
              {order.map((code, i) => {
                const option = question.options.find((o) => o.code === code)
                return (
                  <li key={code}>
                    <button
                      type="button"
                      onClick={() =>
                        onAnswer({
                          kind: 'order',
                          codes: order.filter((c) => c !== code),
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-lg border border-neutral-900 bg-neutral-50 px-4 py-3 text-left"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs text-white tabular-nums">
                        {i + 1}
                      </span>
                      <span className="flex-1">{option?.label}</span>
                      <span className="text-xs text-neutral-500">remove</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}

          {order.length < wanted && unranked.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">
                {order.length === 0
                  ? 'Tap them in order, most first.'
                  : `Next: number ${order.length + 1}`}
              </p>
              {unranked.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() =>
                    onAnswer({ kind: 'order', codes: [...order, option.code] })
                  }
                  className="w-full rounded-lg border border-neutral-200 px-4 py-3 text-left transition hover:border-neutral-400"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )
    }

    case 'allocation': {
      const parts = answer?.kind === 'allocation' ? answer.parts : {}
      const target = question.max ?? 100
      const used = Object.values(parts).reduce((sum, n) => sum + n, 0)
      const left = target - used

      return (
        <div className="space-y-3">
          {question.options.map((option) => (
            <div key={option.code} className="flex items-center gap-3">
              <label className="flex-1 text-sm">{option.label}</label>
              <input
                type="number"
                min={0}
                max={target}
                inputMode="numeric"
                value={parts[option.code] ?? ''}
                onChange={(e) => {
                  const next = { ...parts }
                  if (e.target.value === '') delete next[option.code]
                  else next[option.code] = Number(e.target.value)
                  onAnswer(
                    Object.keys(next).length
                      ? { kind: 'allocation', parts: next }
                      : undefined
                  )
                }}
                className="w-24 rounded-md border border-neutral-300 px-3 py-2 text-right tabular-nums focus:border-neutral-900 focus:outline-none"
              />
            </div>
          ))}
          {/*
            The remaining amount, always visible. This type fails when someone
            cannot tell how far off they are, and making them do the arithmetic
            is how a form gets abandoned.
          */}
          <p
            className={`text-sm tabular-nums ${
              left === 0 ? 'text-green-700' : 'text-neutral-600'
            }`}
          >
            {left === 0
              ? `That is all ${target}.`
              : left > 0
                ? `${left} left to give out.`
                : `${-left} too many.`}
          </p>
        </div>
      )
    }

    case 'text':
      return (
        <textarea
          rows={4}
          maxLength={MAX_TEXT_ANSWER}
          value={answer?.kind === 'text' ? answer.value : ''}
          onChange={(event) =>
            onAnswer(
              event.target.value
                ? { kind: 'text', value: event.target.value }
                : undefined
            )
          }
          className="w-full rounded-lg border border-neutral-300 px-4 py-3 focus:border-neutral-900 focus:outline-none"
        />
      )
  }
}
