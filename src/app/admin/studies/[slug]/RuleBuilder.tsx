'use client'

/**
 * The rule builder, shared by the question editor and the variable editor.
 *
 * One copy rather than two because the two would drift, and a branching rule
 * that means something different depending on which screen wrote it is the
 * kind of divergence nobody notices until a study fields wrongly.
 *
 * It draws one level of the condition language: a combinator over a flat list
 * of tests, which is what almost every real rule is. Anything nested deeper is
 * shown as stored rather than flattened - silently rewriting someone's logic to
 * fit the UI is worse than admitting the UI cannot draw it.
 */

import type { Operator } from '@/lib/conditions'

/** The minimum a rule needs to know about a question it can refer to. */
export interface Referable {
  code: string
  options: { code: number; label: string }[]
}

const OPERATORS: { value: Operator; label: string; needsValue: boolean }[] = [
  { value: 'is', label: 'is', needsValue: true },
  { value: 'is_not', label: 'is not', needsValue: true },
  { value: 'includes', label: 'includes', needsValue: true },
  { value: 'excludes', label: 'does not include', needsValue: true },
  { value: 'gte', label: 'is at least', needsValue: true },
  { value: 'lte', label: 'is at most', needsValue: true },
  { value: 'gt', label: 'is more than', needsValue: true },
  { value: 'lt', label: 'is less than', needsValue: true },
  { value: 'answered', label: 'was answered', needsValue: false },
  { value: 'not_answered', label: 'was not answered', needsValue: false },
]


export interface Test {
  q: string
  op: Operator
  value?: string | number
}

/** A rule the builder can draw: one combinator over a flat list of tests. */
export interface SimpleRule {
  combinator: 'all' | 'any'
  tests: Test[]
}

const isTest = (v: unknown): v is Test =>
  typeof v === 'object' && v !== null && 'q' in v && 'op' in v

/**
 * Reads a stored rule into the builder's shape, or returns null when it is
 * nested beyond one level. Null means "show the JSON", never "throw it away".
 */
export function toSimple(rule: unknown): SimpleRule | null {
  if (!rule) return { combinator: 'all', tests: [] }
  if (isTest(rule)) return { combinator: 'all', tests: [rule] }
  const object = rule as Record<string, unknown>
  for (const combinator of ['all', 'any'] as const) {
    const list = object[combinator]
    if (Array.isArray(list) && list.every(isTest)) {
      return { combinator, tests: list as Test[] }
    }
  }
  return null
}

export function fromSimple(rule: SimpleRule): Record<string, unknown> | null {
  const tests = rule.tests.filter((t) => t.q && t.op)
  if (!tests.length) return null
  if (tests.length === 1) return tests[0] as unknown as Record<string, unknown>
  return { [rule.combinator]: tests } as Record<string, unknown>
}

export default function RuleEditor({
  title,
  hint,
  rule,
  available,
  readOnly,
  onChange,
}: {
  title: string
  hint: string
  rule: Record<string, unknown> | null
  available: Referable[]
  readOnly: boolean
  onChange: (rule: Record<string, unknown> | null) => void
}) {
  const simple = toSimple(rule)

  // A nested rule is shown rather than flattened. Rewriting someone's
  // branching to fit the builder would be a worse outcome than saying so.
  if (!simple) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
        <span className="text-xs font-medium text-amber-900">{title}</span>
        <p className="mt-1 text-xs text-amber-800">
          This rule nests deeper than the builder draws, so it is shown as it is
          stored. Editing it here would change what it means.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-white px-3 py-2 text-xs">
          {JSON.stringify(rule, null, 2)}
        </pre>
      </div>
    )
  }

  const update = (next: SimpleRule) => onChange(fromSimple(next))

  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <span className="text-xs font-medium text-neutral-700">{title}</span>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>

      {simple.tests.length > 1 && (
        <label className="mt-2 block text-xs">
          <select
            disabled={readOnly}
            value={simple.combinator}
            onChange={(e) =>
              update({ ...simple, combinator: e.target.value as 'all' | 'any' })
            }
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="all">All of these are true</option>
            <option value="any">Any of these is true</option>
          </select>
        </label>
      )}

      <div className="mt-2 space-y-2">
        {simple.tests.map((test, i) => {
          const operator = OPERATORS.find((o) => o.value === test.op)
          const referenced = available.find((q) => q.code === test.q)
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                disabled={readOnly}
                value={test.q}
                onChange={(e) =>
                  update({
                    ...simple,
                    tests: simple.tests.map((t, j) =>
                      j === i ? { ...t, q: e.target.value } : t
                    ),
                  })
                }
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
              >
                <option value="">choose a question</option>
                {available.map((q) => (
                  <option key={q.code} value={q.code}>
                    {q.code}
                  </option>
                ))}
                {test.q && !referenced && (
                  <option value={test.q}>{test.q} (not above this)</option>
                )}
              </select>

              <select
                disabled={readOnly}
                value={test.op}
                onChange={(e) =>
                  update({
                    ...simple,
                    tests: simple.tests.map((t, j) =>
                      j === i ? { ...t, op: e.target.value as Operator } : t
                    ),
                  })
                }
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {operator?.needsValue &&
                (referenced?.options.length ? (
                  <select
                    disabled={readOnly}
                    value={String(test.value ?? '')}
                    onChange={(e) =>
                      update({
                        ...simple,
                        tests: simple.tests.map((t, j) =>
                          j === i ? { ...t, value: e.target.value } : t
                        ),
                      })
                    }
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  >
                    <option value="">choose</option>
                    {referenced.options.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label || `option ${o.code}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={readOnly}
                    value={String(test.value ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value
                      const asNumber = Number(raw)
                      update({
                        ...simple,
                        tests: simple.tests.map((t, j) =>
                          j === i
                            ? {
                                ...t,
                                value:
                                  raw !== '' && Number.isFinite(asNumber)
                                    ? asNumber
                                    : raw,
                              }
                            : t
                        ),
                      })
                    }}
                    className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
                  />
                ))}

              {!readOnly && (
                <button
                  type="button"
                  onClick={() =>
                    update({
                      ...simple,
                      tests: simple.tests.filter((_, j) => j !== i),
                    })
                  }
                  className="text-xs text-neutral-400 hover:text-red-700"
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {!readOnly && available.length > 0 && (
        <button
          type="button"
          onClick={() =>
            update({
              ...simple,
              tests: [...simple.tests, { q: available[0].code, op: 'is', value: '' }],
            })
          }
          className="mt-2 text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          Add a condition
        </button>
      )}
      {available.length === 0 && (
        <p className="mt-2 text-xs text-neutral-400">
          Nothing to refer to yet.
        </p>
      )}
    </div>
  )
}

