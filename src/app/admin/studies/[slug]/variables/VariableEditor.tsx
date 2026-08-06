'use client'

/**
 * Variables that are not answers.
 *
 * Two quite different things share this screen because they share a column in
 * the delivered file, which is the only place a client meets them. A hidden
 * variable is read off the link; a derived one is computed from the answers.
 * Neither is asked.
 */

import { useState } from 'react'
import RuleEditor, { type Referable } from '../RuleBuilder'

export interface EditableVariable {
  name: string
  label: string | null
  kind: 'hidden' | 'derived'
  sourceParam: string | null
  rule: {
    buckets: { code: number; label: string; when: Record<string, unknown> }[]
    otherwise?: { code: number; label: string }
  } | null
}

export default function VariableEditor({
  slug,
  initial,
  questions,
  readOnly,
}: {
  slug: string
  initial: EditableVariable[]
  questions: Referable[]
  readOnly: boolean
}) {
  const [variables, setVariables] = useState<EditableVariable[]>(initial)
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const change = (index: number, patch: Partial<EditableVariable>) => {
    setVariables((vs) => vs.map((v, i) => (i === index ? { ...v, ...patch } : v)))
    setSaved(false)
  }

  function add(kind: 'hidden' | 'derived') {
    setVariables((vs) => [
      ...vs,
      {
        name: kind === 'hidden' ? `hidden_${vs.length + 1}` : `derived_${vs.length + 1}`,
        label: null,
        kind,
        sourceParam: kind === 'hidden' ? 'src' : null,
        rule:
          kind === 'derived'
            ? { buckets: [], otherwise: { code: 99, label: 'Everyone else' } }
            : null,
      },
    ])
    setOpen(variables.length)
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/studies/${slug}/variables`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variables }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Could not save those.')
        return
      }
      setSaved(true)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8">
      <ol className="space-y-3">
        {variables.map((v, index) => {
          const isOpen = open === index
          return (
            <li key={index} className="rounded-lg border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : index)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-xs text-neutral-500">
                    {v.kind === 'hidden'
                      ? `from the link · ?${v.sourceParam ?? '…'}=`
                      : `computed · ${v.rule?.buckets.length ?? 0} rules`}
                  </span>
                  <span className="block truncate font-medium">
                    {v.name}
                    {v.label ? ` — ${v.label}` : ''}
                  </span>
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setVariables((vs) => vs.filter((_, j) => j !== index))
                      setOpen(null)
                      setSaved(false)
                    }}
                    className="text-xs text-neutral-500 underline hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="space-y-4 border-t border-neutral-200 p-4">
                  <div className="flex flex-wrap gap-3">
                    <label>
                      <span className="text-xs font-medium text-neutral-700">
                        Column name
                      </span>
                      <input
                        disabled={readOnly}
                        value={v.name}
                        onChange={(e) =>
                          change(index, {
                            name: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, '_'),
                          })
                        }
                        className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="min-w-48 flex-1">
                      <span className="text-xs font-medium text-neutral-700">
                        Label
                      </span>
                      <input
                        disabled={readOnly}
                        value={v.label ?? ''}
                        onChange={(e) =>
                          change(index, { label: e.target.value || null })
                        }
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  {v.kind === 'hidden' ? (
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-700">
                        Read from this query parameter
                      </span>
                      <input
                        disabled={readOnly}
                        value={v.sourceParam ?? ''}
                        placeholder="src"
                        onChange={(e) =>
                          change(index, { sourceParam: e.target.value || null })
                        }
                        className="mt-1 w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                      />
                      <span className="mt-1 block text-xs text-neutral-500">
                        Captured when they consent, which is the only moment the
                        link is reliably there - someone returning tomorrow
                        arrives at a bare address.
                      </span>
                    </label>
                  ) : (
                    <Buckets
                      variable={v}
                      questions={questions}
                      readOnly={readOnly}
                      onChange={(rule) => change(index, { rule })}
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
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => add('hidden')}
              className="rounded-md border border-dashed border-neutral-400 px-4 py-2 text-sm hover:border-neutral-600"
            >
              Add one from the link
            </button>
            <button
              type="button"
              onClick={() => add('derived')}
              className="rounded-md border border-dashed border-neutral-400 px-4 py-2 text-sm hover:border-neutral-600"
            >
              Add a computed one
            </button>
          </div>

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
              {busy ? 'Saving…' : `Save ${variables.length} variables`}
            </button>
            {saved && <span className="text-sm text-green-700">Saved</span>}
          </div>
        </>
      )}
    </div>
  )
}

function Buckets({
  variable,
  questions,
  readOnly,
  onChange,
}: {
  variable: EditableVariable
  questions: Referable[]
  readOnly: boolean
  onChange: (rule: EditableVariable['rule']) => void
}) {
  const rule = variable.rule ?? { buckets: [], otherwise: undefined }

  return (
    <div>
      <span className="text-xs font-medium text-neutral-700">
        Which value each respondent gets
      </span>
      <p className="mt-0.5 text-xs text-neutral-500">
        Checked top to bottom, and the first one that fits wins. That ordering
        is part of the definition - moving a rule changes the variable, it is
        not a tidy-up.
      </p>

      <ol className="mt-3 space-y-3">
        {rule.buckets.map((bucket, i) => (
          <li key={i} className="rounded-md border border-neutral-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-500">value</span>
              <input
                type="number"
                disabled={readOnly}
                value={bucket.code}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    buckets: rule.buckets.map((b, j) =>
                      j === i ? { ...b, code: Number(e.target.value) } : b
                    ),
                  })
                }
                className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-xs tabular-nums"
              />
              <input
                disabled={readOnly}
                value={bucket.label}
                placeholder="what it means"
                onChange={(e) =>
                  onChange({
                    ...rule,
                    buckets: rule.buckets.map((b, j) =>
                      j === i ? { ...b, label: e.target.value } : b
                    ),
                  })
                }
                className="min-w-40 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs"
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...rule,
                      buckets: rule.buckets.filter((_, j) => j !== i),
                    })
                  }
                  className="text-xs text-neutral-400 hover:text-red-700"
                >
                  ×
                </button>
              )}
            </div>

            <div className="mt-2">
              <RuleEditor
                title="when"
                hint="Only answers can be used here - never their records."
                rule={bucket.when}
                available={questions}
                readOnly={readOnly}
                onChange={(when) =>
                  onChange({
                    ...rule,
                    buckets: rule.buckets.map((b, j) =>
                      j === i ? { ...b, when: when ?? {} } : b
                    ),
                  })
                }
              />
            </div>
          </li>
        ))}
      </ol>

      {!readOnly && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...rule,
              buckets: [
                ...rule.buckets,
                { code: rule.buckets.length + 1, label: '', when: {} },
              ],
            })
          }
          className="mt-3 text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          Add a rule
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
        <span className="text-xs text-neutral-600">Everyone else gets</span>
        <input
          type="number"
          disabled={readOnly}
          value={rule.otherwise?.code ?? ''}
          placeholder="99"
          onChange={(e) =>
            onChange({
              ...rule,
              otherwise: e.target.value
                ? {
                    code: Number(e.target.value),
                    label: rule.otherwise?.label ?? '',
                  }
                : undefined,
            })
          }
          className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-xs tabular-nums"
        />
        <input
          disabled={readOnly}
          value={rule.otherwise?.label ?? ''}
          placeholder="label"
          onChange={(e) =>
            onChange({
              ...rule,
              otherwise: {
                code: rule.otherwise?.code ?? 99,
                label: e.target.value,
              },
            })
          }
          className="w-48 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        />
        <span className="text-xs text-neutral-400">
          Leave empty to give them nothing at all.
        </span>
      </div>
    </div>
  )
}
