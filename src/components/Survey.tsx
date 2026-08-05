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
  validateAnswer,
  MAX_TEXT_ANSWER,
  type AnswerValue,
  type Answers,
  type Question,
} from '@/lib/survey'

interface Props {
  questions: Question[]
  answers: Answers
  onAnswer: (code: string, value: AnswerValue | undefined) => void
  onDone: () => Promise<string | null>
}

export default function Survey({ questions, answers, onAnswer, onDone }: Props) {
  const pages = groupIntoPages(questions)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Problems stay hidden until Continue is pressed. Telling someone their
  // answer is wrong before they have finished giving it is just nagging.
  const [showProblems, setShowProblems] = useState(false)

  const page = pages[index]
  if (!page) return null

  const isLast = index === pages.length - 1
  const complete = pageIsComplete(page, answers)

  async function next() {
    if (!complete) {
      setShowProblems(true)
      return
    }
    setShowProblems(false)
    if (!isLast) {
      setIndex(index + 1)
      window.scrollTo({ top: 0 })
      return
    }
    setBusy(true)
    setError(null)
    const problem = await onDone()
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <section>
      <div className="flex items-center gap-3">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={pages.length}
        >
          <div
            className="h-full bg-neutral-900 transition-all"
            style={{ width: `${((index + 1) / pages.length) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {index + 1} of {pages.length}
        </span>
      </div>

      <div className="mt-10 space-y-12">
        {page.questions.map((question) => (
          <QuestionField
            key={question.code}
            question={question}
            answer={answers[question.code]}
            onAnswer={(value) => onAnswer(question.code, value)}
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
        {index > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowProblems(false)
              setIndex(index - 1)
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
  onAnswer,
  problem,
}: {
  question: Question
  answer: AnswerValue | undefined
  onAnswer: (value: AnswerValue | undefined) => void
  problem: string | null
}) {
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
        <Field question={question} answer={answer} onAnswer={onAnswer} />
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
  switch (question.type) {
    case 'single':
      return (
        <div className="space-y-2">
          {question.options.map((option) => {
            const chosen = answer?.kind === 'choice' && answer.value === option.value
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                  chosen
                    ? 'border-neutral-900 bg-neutral-50'
                    : 'border-neutral-200 hover:border-neutral-400'
                }`}
              >
                <input
                  type="radio"
                  name={question.code}
                  checked={chosen}
                  onChange={() => onAnswer({ kind: 'choice', value: option.value })}
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )

    case 'multiple': {
      const chosen = answer?.kind === 'choices' ? answer.values : []
      /**
       * An exclusive option clears the rest and is cleared by them. "None of
       * these" ticked alongside three services is not a mistake we should keep
       * and then have to decide how to code.
       */
      const exclusive = new Set(['none', 'none_of_these', 'na'])
      return (
        <div className="space-y-2">
          {question.options.map((option) => {
            const isChosen = chosen.includes(option.value)
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition ${
                  isChosen
                    ? 'border-neutral-900 bg-neutral-50'
                    : 'border-neutral-200 hover:border-neutral-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChosen}
                  onChange={() => {
                    let values: string[]
                    if (isChosen) {
                      values = chosen.filter((v) => v !== option.value)
                    } else if (exclusive.has(option.value)) {
                      values = [option.value]
                    } else {
                      values = [
                        ...chosen.filter((v) => !exclusive.has(v)),
                        option.value,
                      ]
                    }
                    onAnswer({ kind: 'choices', values })
                  }}
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )
    }

    case 'scale': {
      const points = scalePoints(question)
      const chosen = answer?.kind === 'number' ? answer.value : null
      return (
        <div>
          <div className="flex gap-1.5">
            {points.map((point) => (
              <button
                key={point}
                type="button"
                onClick={() => onAnswer({ kind: 'number', value: point })}
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
          {(question.minLabel || question.maxLabel) && (
            <div className="mt-2 flex justify-between text-xs text-neutral-500">
              <span>{question.minLabel}</span>
              <span>{question.maxLabel}</span>
            </div>
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
