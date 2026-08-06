'use client'

/**
 * The instrument editor.
 *
 * Three things here are not ordinary form work and are the reason this file is
 * long:
 *
 *   Codes are the analysis key. Answers are stored against them, so renaming
 *   one on a study that has already fielded orphans its data - the editor says
 *   so rather than letting it happen quietly.
 *
 *   Rules are a closed language, and the builder exposes one level of it. A
 *   rule too complex for the builder is shown as JSON rather than being
 *   flattened, because silently rewriting someone's branching is worse than
 *   admitting the UI cannot draw it.
 *
 *   Claims are what separates this from a form builder. A question with no
 *   claim is never reconciled, so the binding is offered next to the question
 *   rather than hidden in an advanced panel.
 */

import { useState } from 'react'
import { SOURCE_LABELS, type SourceKind } from '@/lib/records'
import type { Condition } from '@/lib/conditions'
import RuleEditor from '../RuleBuilder'

import { isAnswerable, type QuestionType as QType } from '@/lib/survey'

export interface EditableQuestion {
  code: string
  page: number
  type: QType
  prompt: string
  help: string | null
  options: { code: number; label: string; mapsTo?: string; exclusive?: boolean }[]
  mediaUrl: string | null
  mediaAlt: string | null
  qualityCheck: Record<string, unknown> | null
  allowOther: boolean
  allowPreferNotToSay: boolean
  minSelections: number | null
  maxSelections: number | null
  required: boolean
  min: number | null
  max: number | null
  minLabel: string | null
  maxLabel: string | null
  claim: Record<string, unknown> | null
  showIf: Record<string, unknown> | null
  terminateIf: Record<string, unknown> | null
}

const TYPES: { value: QType; label: string; group: string }[] = [
  { value: 'single', label: 'One choice', group: 'Asks something' },
  { value: 'multiple', label: 'Several choices', group: 'Asks something' },
  { value: 'scale', label: 'Scale', group: 'Asks something' },
  { value: 'number', label: 'Number', group: 'Asks something' },
  { value: 'text', label: 'Open text', group: 'Asks something' },
  { value: 'date', label: 'A date', group: 'Asks something' },
  { value: 'ranking', label: 'Put in order', group: 'Asks something' },
  { value: 'allocation', label: 'Split 100 points', group: 'Asks something' },
  { value: 'section', label: 'Section heading', group: 'Shows something' },
  { value: 'description', label: 'Explanatory text', group: 'Shows something' },
  { value: 'media', label: 'Image', group: 'Shows something' },
  { value: 'terminal', label: 'End the survey here', group: 'Shows something' },
]

const CLAIM_SOURCES: SourceKind[] = [
  'google_search',
  'google_ai_mode',
  'google_image_search',
  'google_video_search',
  'google_hotels',
  'google_shopping',
  'google_maps',
  'youtube',
  'youtube_engagement',
  'gemini',
  'chatgpt',
]

export default function QuestionEditor({
  slug,
  initial,
  hasFielded,
  readOnly,
}: {
  slug: string
  initial: EditableQuestion[]
  hasFielded: boolean
  readOnly: boolean
}) {
  const [questions, setQuestions] = useState<EditableQuestion[]>(initial)
  const [open, setOpen] = useState<number | null>(initial.length ? 0 : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const originalCodes = new Set(initial.map((q) => q.code))

  const change = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...q, ...patch } : q)))
    setSaved(false)
  }

  function add() {
    const n = questions.length + 1
    setQuestions((qs) => [
      ...qs,
      {
        code: `q${n}`,
        page: qs.length,
        type: 'single',
        prompt: '',
        help: null,
        options: [
          { code: 1, label: 'Yes', mapsTo: 'yes' },
          { code: 2, label: 'No', mapsTo: 'no' },
        ],
        mediaUrl: null,
        mediaAlt: null,
        qualityCheck: null,
        allowOther: false,
        allowPreferNotToSay: false,
        minSelections: null,
        maxSelections: null,
        required: true,
        min: null,
        max: null,
        minLabel: null,
        maxLabel: null,
        claim: null,
        showIf: null,
        terminateIf: null,
      },
    ])
    setOpen(questions.length)
    setSaved(false)
  }

  function move(index: number, by: number) {
    const to = index + by
    if (to < 0 || to >= questions.length) return
    setQuestions((qs) => {
      const next = [...qs]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
    setOpen(to)
    setSaved(false)
  }

  function remove(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index))
    setOpen(null)
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/studies/${slug}/questions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questions: questions.map((q, i) => ({ ...q, position: i + 1 })),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Could not save the questions.')
        return
      }
      setSaved(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  /** Only earlier questions can be referenced; a later one can never fire. */
  const earlierThan = (index: number) => questions.slice(0, index)

  return (
    <div className="mt-8">
      {hasFielded && (
        <p className="mb-6 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This study has already collected answers. Editing a question&apos;s
          code orphans the answers given to it - the text and options can change
          safely, the code cannot.
        </p>
      )}

      <ol className="space-y-3">
        {questions.map((q, index) => {
          const isOpen = open === index
          const renamed = hasFielded && !originalCodes.has(q.code)
          return (
            <li
              key={index}
              className="rounded-lg border border-neutral-200 bg-white"
            >
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-xs text-neutral-500">
                    {q.code} · page {q.page + 1} ·{' '}
                    {TYPES.find((t) => t.value === q.type)?.label}
                    {!isAnswerable(q.type) ? ' · collects nothing' : ''}
                    {q.showIf ? ' · conditional' : ''}
                    {q.terminateIf ? ' · can end the survey' : ''}
                    {q.claim ? ' · reconciled' : ''}
                  </span>
                  <span className="block truncate font-medium">
                    {q.prompt || <span className="text-neutral-400">No text yet</span>}
                  </span>
                </button>
                {!readOnly && (
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === questions.length - 1}
                      className="rounded border border-neutral-200 px-2 py-1 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="ml-2 text-neutral-500 underline hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="space-y-5 border-t border-neutral-200 p-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="min-w-40">
                      <span className="text-xs font-medium text-neutral-700">
                        Code
                      </span>
                      <input
                        value={q.code}
                        disabled={readOnly}
                        onChange={(e) =>
                          change(index, {
                            code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                          })
                        }
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                      {renamed && (
                        <span className="mt-1 block text-xs text-amber-800">
                          Answers already given under the old code will be
                          orphaned.
                        </span>
                      )}
                    </label>
                    <label>
                      <span className="text-xs font-medium text-neutral-700">
                        Type
                      </span>
                      <select
                        value={q.type}
                        disabled={readOnly}
                        onChange={(e) =>
                          change(index, { type: e.target.value as QType })
                        }
                        className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      >
                        {['Asks something', 'Shows something'].map((group) => (
                          <optgroup key={group} label={group}>
                            {TYPES.filter((t) => t.group === group).map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="text-xs font-medium text-neutral-700">
                        Screen
                      </span>
                      <input
                        type="number"
                        min={1}
                        disabled={readOnly}
                        value={q.page + 1}
                        onChange={(e) =>
                          change(index, {
                            page: Math.max(0, Number(e.target.value) - 1),
                          })
                        }
                        className="mt-1 block w-24 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </label>
                    {isAnswerable(q.type) && (
                      <label className="flex items-end gap-2 pb-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={q.required}
                          onChange={(e) =>
                            change(index, { required: e.target.checked })
                          }
                        />
                        Required
                      </label>
                    )}
                  </div>

                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">
                      {q.type === 'section'
                        ? 'Heading'
                        : q.type === 'description'
                          ? 'Text to show'
                          : q.type === 'media'
                            ? 'Caption'
                            : q.type === 'terminal'
                              ? 'What to say as it ends'
                              : 'Question'}
                    </span>
                    <textarea
                      rows={2}
                      disabled={readOnly}
                      value={q.prompt}
                      onChange={(e) => change(index, { prompt: e.target.value })}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">
                      Help text
                    </span>
                    <input
                      disabled={readOnly}
                      value={q.help ?? ''}
                      onChange={(e) =>
                        change(index, { help: e.target.value || null })
                      }
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </label>

                  {q.type === 'media' && (
                    <div className="flex flex-wrap gap-3">
                      <label className="min-w-64 flex-1">
                        <span className="text-xs font-medium text-neutral-700">
                          Image address
                        </span>
                        <input
                          disabled={readOnly}
                          value={q.mediaUrl ?? ''}
                          placeholder="https://…"
                          onChange={(e) =>
                            change(index, { mediaUrl: e.target.value || null })
                          }
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="min-w-48 flex-1">
                        <span className="text-xs font-medium text-neutral-700">
                          Described, for anyone who cannot see it
                        </span>
                        <input
                          disabled={readOnly}
                          value={q.mediaAlt ?? ''}
                          onChange={(e) =>
                            change(index, { mediaAlt: e.target.value || null })
                          }
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  )}

                  {['single', 'multiple', 'ranking', 'allocation'].includes(
                    q.type
                  ) && (
                    <Options
                      question={q}
                      readOnly={readOnly}
                      onChange={(patch) => change(index, patch)}
                    />
                  )}

                  {q.type === 'allocation' && (
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-700">
                        Points to divide
                      </span>
                      <input
                        type="number"
                        min={1}
                        disabled={readOnly}
                        value={q.max ?? 100}
                        onChange={(e) =>
                          change(index, { max: Number(e.target.value) || 100 })
                        }
                        className="mt-1 block w-28 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                      <span className="mt-1 block text-xs text-neutral-500">
                        They must give out exactly this much.
                      </span>
                    </label>
                  )}

                  {q.type === 'ranking' && (
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-700">
                        How many to rank
                      </span>
                      <input
                        type="number"
                        min={2}
                        disabled={readOnly}
                        value={q.maxSelections ?? ''}
                        placeholder={String(q.options.length || 'all')}
                        onChange={(e) =>
                          change(index, {
                            maxSelections: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        className="mt-1 block w-28 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                      <span className="mt-1 block text-xs text-neutral-500">
                        Leave empty to rank them all. A top three is often a
                        better question than a full order.
                      </span>
                    </label>
                  )}

                  {(q.type === 'scale' || q.type === 'number') && (
                    <div className="flex flex-wrap gap-3">
                      {(
                        [
                          ['min', 'Lowest'],
                          ['max', 'Highest'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <span className="text-xs font-medium text-neutral-700">
                            {label}
                          </span>
                          <input
                            type="number"
                            disabled={readOnly}
                            value={q[key] ?? ''}
                            onChange={(e) =>
                              change(index, {
                                [key]: e.target.value === '' ? null : Number(e.target.value),
                              } as Partial<EditableQuestion>)
                            }
                            className="mt-1 block w-28 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                          />
                        </label>
                      ))}
                      {q.type === 'scale' && (
                        <>
                          <label>
                            <span className="text-xs font-medium text-neutral-700">
                              Label at the low end
                            </span>
                            <input
                              disabled={readOnly}
                              value={q.minLabel ?? ''}
                              onChange={(e) =>
                                change(index, { minLabel: e.target.value || null })
                              }
                              className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>
                          <label>
                            <span className="text-xs font-medium text-neutral-700">
                              At the high end
                            </span>
                            <input
                              disabled={readOnly}
                              value={q.maxLabel ?? ''}
                              onChange={(e) =>
                                change(index, { maxLabel: e.target.value || null })
                              }
                              className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  <RuleEditor
                    title="Ask this only when"
                    hint="Leave empty to always ask it. Only questions above this one can be used - a rule pointing forwards can never fire."
                    rule={q.showIf}
                    available={earlierThan(index)}
                    readOnly={readOnly}
                    onChange={(showIf) => change(index, { showIf })}
                  />

                  <RuleEditor
                    title="End the survey when"
                    hint="A screen-out. It is checked as they leave this screen, so it may refer to this question."
                    rule={q.terminateIf}
                    available={[...earlierThan(index), q]}
                    readOnly={readOnly}
                    onChange={(terminateIf) => change(index, { terminateIf })}
                  />

                  {isAnswerable(q.type) && (
                    <QualityEditor
                      question={q}
                      earlier={earlierThan(index)}
                      readOnly={readOnly}
                      onChange={(qualityCheck) => change(index, { qualityCheck })}
                    />
                  )}

                  {isAnswerable(q.type) && (
                    <ClaimEditor
                      claim={q.claim}
                      readOnly={readOnly}
                      onChange={(claim) => change(index, { claim })}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {!readOnly && (
        <>
          <button
            type="button"
            onClick={add}
            className="mt-4 rounded-md border border-dashed border-neutral-400 px-4 py-2 text-sm hover:border-neutral-600"
          >
            Add a question
          </button>

          {error && (
            <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </p>
          )}

          <div className="mt-8 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : `Save ${questions.length} questions`}
            </button>
            {saved && <span className="text-sm text-green-700">Saved</span>}
          </div>
        </>
      )}
    </div>
  )
}

function Options({
  question,
  readOnly,
  onChange,
}: {
  question: EditableQuestion
  readOnly: boolean
  onChange: (patch: Partial<EditableQuestion>) => void
}) {
  /**
   * The next code is one past the highest ever used, not the length of the
   * list. Reusing the code of a deleted option would silently merge two
   * different answers in the delivered file - last wave's "Bing" becoming this
   * wave's "Perplexity" under the same column.
   */
  const nextCode = () =>
    question.options.reduce((max, o) => Math.max(max, o.code), 0) + 1

  return (
    <div>
      <span className="text-xs font-medium text-neutral-700">Options</span>
      <p className="text-xs text-neutral-500">
        The code is what lands in the data and cannot be changed once it exists.
        The label is what they read and can change whenever the wording needs
        to. &quot;Means&quot; is only read by reconcile - set it to a source
        name to bind an option to it.
      </p>

      <div className="mt-2 space-y-2">
        {question.options.map((option, i) => (
          <div key={option.code} className="flex flex-wrap items-center gap-2">
            <span
              className="w-10 shrink-0 rounded bg-neutral-100 px-2 py-1.5 text-center text-xs tabular-nums text-neutral-600"
              title="Fixed once created"
            >
              {option.code}
            </span>
            <input
              disabled={readOnly}
              value={option.label}
              placeholder="what they read"
              onChange={(e) =>
                onChange({
                  options: question.options.map((o, j) =>
                    j === i ? { ...o, label: e.target.value } : o
                  ),
                })
              }
              className="min-w-40 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <input
              disabled={readOnly}
              value={option.mapsTo ?? ''}
              placeholder="means (optional)"
              onChange={(e) =>
                onChange({
                  options: question.options.map((o, j) =>
                    j === i ? { ...o, mapsTo: e.target.value || undefined } : o
                  ),
                })
              }
              className="w-44 rounded-md border border-neutral-200 px-3 py-1.5 text-xs"
            />
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={option.exclusive ?? false}
                onChange={(e) =>
                  onChange({
                    options: question.options.map((o, j) =>
                      j === i ? { ...o, exclusive: e.target.checked } : o
                    ),
                  })
                }
              />
              only
            </label>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  onChange({ options: question.options.filter((_, j) => j !== i) })
                }
                className="px-2 text-sm text-neutral-400 hover:text-red-700"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={() =>
            onChange({
              options: [
                ...question.options,
                { code: nextCode(), label: '' },
              ],
            })
          }
          className="mt-2 text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          Add an option
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-neutral-100 pt-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={question.allowOther}
            onChange={(e) => onChange({ allowOther: e.target.checked })}
          />
          Other, please specify <span className="text-neutral-400">(97)</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={question.allowPreferNotToSay}
            onChange={(e) => onChange({ allowPreferNotToSay: e.target.checked })}
          />
          Prefer not to say <span className="text-neutral-400">(98)</span>
        </label>

        {question.type === 'multiple' && (
          <>
            <label className="flex items-center gap-2 text-xs">
              at least
              <input
                type="number"
                min={0}
                disabled={readOnly}
                value={question.minSelections ?? ''}
                onChange={(e) =>
                  onChange({
                    minSelections: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="w-16 rounded-md border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              at most
              <input
                type="number"
                min={1}
                disabled={readOnly}
                value={question.maxSelections ?? ''}
                onChange={(e) =>
                  onChange({
                    maxSelections: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="w-16 rounded-md border border-neutral-300 px-2 py-1"
              />
            </label>
          </>
        )}
      </div>
    </div>
  )
}

function ClaimEditor({
  claim,
  readOnly,
  onChange,
}: {
  claim: Record<string, unknown> | null
  readOnly: boolean
  onChange: (claim: Record<string, unknown> | null) => void
}) {
  const kind = (claim?.kind as string) ?? 'none'
  const sources = (claim?.sources as string[]) ?? []
  const terms = (claim?.terms as string[]) ?? []
  const windowDays = (claim?.windowDays as number) ?? 30

  return (
    <div className="rounded-md border border-neutral-900 p-3">
      <span className="text-xs font-medium">What this claims about their records</span>
      <p className="mt-0.5 text-xs text-neutral-600">
        Only questions with a binding are reconciled. Without one the answer is
        collected and never compared to anything.
      </p>

      <select
        disabled={readOnly}
        value={kind}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'none') return onChange(null)
          if (next === 'source_use') return onChange({ kind: 'source_use' })
          if (next === 'search_frequency')
            return onChange({ kind: 'search_frequency', sources: [], windowDays: 30 })
          if (next === 'recency')
            return onChange({ kind: 'recency', sources: [], terms: [] })
          if (next === 'rank_frequency')
            return onChange({ kind: 'rank_frequency', windowDays: 30 })
          if (next === 'share') return onChange({ kind: 'share', windowDays: 30 })
          onChange({ kind: 'topic_search', terms: [], windowDays: 30 })
        }}
        className="mt-2 block rounded-md border border-neutral-300 px-2 py-1 text-xs"
      >
        <option value="none">Nothing - do not reconcile this</option>
        <option value="source_use">
          Which services they used - option values are source names
        </option>
        <option value="search_frequency">
          How often they did something - the number is a count
        </option>
        <option value="topic_search">
          Whether they looked into a topic - yes means at least one match
        </option>
        <option value="recency">
          When they last did it - compared to the most recent matching record
        </option>
        <option value="rank_frequency">
          Their order of use - compared to the order by record count
        </option>
        <option value="share">
          How their activity splits - compared to the share of records
        </option>
      </select>

      {(kind === 'rank_frequency' || kind === 'share') && (
        <p className="mt-3 text-xs text-neutral-600">
          Each option must say what it means - set that beside the option above,
          to a source name. The order or split is compared across exactly those.
        </p>
      )}

      {(kind === 'search_frequency' || kind === 'recency') && (
        <div className="mt-3">
          <span className="text-xs text-neutral-700">
            {kind === 'recency' ? 'Look for the most recent in' : 'Count records from'}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {CLAIM_SOURCES.map((s) => (
              <label
                key={s}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                  sources.includes(s)
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  disabled={readOnly}
                  checked={sources.includes(s)}
                  onChange={() =>
                    onChange({
                      ...claim,
                      sources: sources.includes(s)
                        ? sources.filter((x) => x !== s)
                        : [...sources, s],
                    })
                  }
                />
                {SOURCE_LABELS[s]}
              </label>
            ))}
          </div>
        </div>
      )}

      {(kind === 'topic_search' || kind === 'recency') && (
        <label className="mt-3 block">
          <span className="text-xs text-neutral-700">
            {kind === 'recency'
              ? 'Words that narrow it, if any'
              : 'Words that count as a match'}
          </span>
          <input
            disabled={readOnly}
            value={terms.join(', ')}
            onChange={(e) =>
              onChange({
                ...claim,
                terms: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            placeholder="insurance, premium, deductible"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs"
          />
        </label>
      )}

      {kind !== 'none' && kind !== 'source_use' && kind !== 'recency' && (
        <label className="mt-3 block">
          <span className="text-xs text-neutral-700">Over the last</span>
          <input
            type="number"
            min={1}
            disabled={readOnly}
            value={windowDays}
            onChange={(e) =>
              onChange({ ...claim, windowDays: Number(e.target.value) || 30 })
            }
            className="ml-2 w-20 rounded-md border border-neutral-300 px-2 py-1 text-xs"
          />
          <span className="ml-2 text-xs text-neutral-700">days</span>
        </label>
      )}
    </div>
  )
}

export type { Condition }

/**
 * Marks a question as a data-quality instrument.
 *
 * The wording says "flags" rather than "removes" everywhere, because that is
 * what happens and because an author who believes a trap screens people out
 * will write a different instrument than one who knows it does not.
 */
function QualityEditor({
  question,
  earlier,
  readOnly,
  onChange,
}: {
  question: EditableQuestion
  earlier: EditableQuestion[]
  readOnly: boolean
  onChange: (check: Record<string, unknown> | null) => void
}) {
  const check = question.qualityCheck
  const kind = (check?.kind as string) ?? 'none'
  const expect = (check?.expect as number[]) ?? []

  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <span className="text-xs font-medium text-neutral-700">
        Is this a quality check?
      </span>
      <p className="mt-0.5 text-xs text-neutral-500">
        Failing one flags the session and never ends it. Their records are still
        good - only what they told us is in doubt - and screening them out would
        also make the failure rate impossible to report.
      </p>

      <select
        disabled={readOnly}
        value={kind}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'none') return onChange(null)
          if (next === 'attention') return onChange({ kind: 'attention', expect: [] })
          if (next === 'duplicate') {
            return onChange({ kind: 'duplicate', of: earlier[0]?.code ?? '' })
          }
          onChange({ kind: next })
        }}
        className="mt-2 block rounded-md border border-neutral-300 px-2 py-1 text-xs"
      >
        <option value="none">No - an ordinary question</option>
        <option value="attention">
          Attention check - the text tells them what to answer
        </option>
        <option value="red_herring">
          Red herring - nothing here is real, so any pick fails
        </option>
        <option value="duplicate">
          Duplicate - should agree with an earlier question
        </option>
        <option value="gibberish">
          Gibberish - open text that is not language
        </option>
      </select>

      {kind === 'attention' && (
        <div className="mt-3">
          <span className="text-xs text-neutral-700">
            Passing means choosing exactly
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            {question.options.map((o) => (
              <label
                key={o.code}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                  expect.includes(o.code)
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  disabled={readOnly}
                  checked={expect.includes(o.code)}
                  onChange={() =>
                    onChange({
                      ...check,
                      kind: 'attention',
                      expect: expect.includes(o.code)
                        ? expect.filter((c) => c !== o.code)
                        : [...expect, o.code],
                    })
                  }
                />
                {o.label || `option ${o.code}`}
              </label>
            ))}
          </div>
          {!question.options.length && (
            <p className="mt-1 text-xs text-amber-800">
              Add the options first, then say which one passes.
            </p>
          )}
        </div>
      )}

      {kind === 'duplicate' && (
        <label className="mt-3 block">
          <span className="text-xs text-neutral-700">Should agree with</span>
          <select
            disabled={readOnly}
            value={(check?.of as string) ?? ''}
            onChange={(e) =>
              onChange({ kind: 'duplicate', of: e.target.value })
            }
            className="ml-2 rounded-md border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="">choose a question</option>
            {earlier.map((q) => (
              <option key={q.code} value={q.code}>
                {q.code}
              </option>
            ))}
          </select>
          {!earlier.length && (
            <span className="ml-2 text-xs text-neutral-400">
              Nothing before this one to compare with.
            </span>
          )}
        </label>
      )}
    </div>
  )
}
