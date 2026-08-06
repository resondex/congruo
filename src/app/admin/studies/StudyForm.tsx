'use client'

import { useState } from 'react'
import { SOURCE_GROUPS, SOURCE_LABELS, type SourceKind } from '@/lib/records'

export interface StudyValues {
  slug: string
  name: string
  mode: 'full_service' | 'append'
  orgId: string | null
  sources: SourceKind[]
  returnHosts: string[]
  defaultReturnUrl: string | null
  windowFrom: string | null
  windowTo: string | null
  exportRawText: boolean
}

/**
 * Create and edit are the same form.
 *
 * Sources are chosen by group, matching what the respondent is actually asked
 * on the consent screen. Offering the underlying sources individually would
 * let a study be configured to collect something the consent copy never names.
 */
export default function StudyForm({
  initial,
  orgs,
  canChooseOrg,
  existing,
}: {
  initial: StudyValues
  orgs: { id: string; name: string }[]
  canChooseOrg: boolean
  existing: boolean
}) {
  const [values, setValues] = useState<StudyValues>(initial)
  const [hosts, setHosts] = useState(initial.returnHosts.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof StudyValues>(key: K, value: StudyValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setSaved(false)
  }

  const chosen = new Set(values.sources)
  const groupOn = (sources: SourceKind[]) => sources.every((s) => chosen.has(s))

  function toggleGroup(sources: SourceKind[]) {
    const on = groupOn(sources)
    const next = new Set(chosen)
    for (const s of sources) {
      if (on) next.delete(s)
      else next.add(s)
    }
    set('sources', [...next])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/studies', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...values,
          returnHosts: hosts
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Could not save that.')
        return
      }
      if (existing) {
        setSaved(true)
      } else {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = `/admin/studies/${data.slug}`
      }
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-2xl space-y-8">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Name</span>
          <input
            type="text"
            required
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Insurance shoppers, wave 1"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Link name</span>
          <input
            type="text"
            required
            disabled={existing}
            value={values.slug}
            onChange={(e) =>
              set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
            }
            placeholder="insurance-w1"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-50 disabled:text-neutral-500 focus:border-neutral-900 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            {existing
              ? 'Fixed once a study exists - it is in every link already sent.'
              : 'Respondents will visit /s/' + (values.slug || '…')}
          </span>
        </label>

        {canChooseOrg && (
          <label className="block">
            <span className="text-sm font-medium text-neutral-700">
              Organisation
            </span>
            <select
              value={values.orgId ?? ''}
              onChange={(e) => set('orgId', e.target.value || null)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            >
              <option value="">No organisation - staff only</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <fieldset className="rounded-lg border border-neutral-200 bg-white p-5">
        <legend className="px-1 text-sm font-medium text-neutral-700">
          How it runs
        </legend>
        <div className="mt-2 space-y-2">
          {(
            [
              [
                'full_service',
                'Full service',
                'We run everything: consent, survey, review, release, reconcile.',
              ],
              [
                'append',
                'Append',
                'Your platform runs the interview. Respondents come to us twice - to consent and start their export, then to review and release.',
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-md border px-4 py-3 ${
                values.mode === value
                  ? 'border-neutral-900 bg-neutral-50'
                  : 'border-neutral-200'
              }`}
            >
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={values.mode === value}
                onChange={() => set('mode', value)}
              />
              <span>
                <span className="text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-xs text-neutral-600">
                  {help}
                </span>
              </span>
            </label>
          ))}
        </div>

        {values.mode === 'append' && (
          <label className="mt-4 block">
            <span className="text-sm font-medium text-neutral-700">
              Return hosts
            </span>
            <input
              type="text"
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
              placeholder="survey.acme.com, qualtrics.com"
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Hostnames only, comma separated. Return addresses arrive in the
              query string, so anything not on this list is refused - without it
              a live study is an open redirect.
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="rounded-lg border border-neutral-200 bg-white p-5">
        <legend className="px-1 text-sm font-medium text-neutral-700">
          What to ask for
        </legend>
        <p className="mt-1 text-xs text-neutral-600">
          Respondents see these as the items on the consent screen.
        </p>
        <div className="mt-3 space-y-2">
          {SOURCE_GROUPS.map((group) => (
            <label
              key={group.id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 ${
                groupOn(group.sources)
                  ? 'border-neutral-900 bg-neutral-50'
                  : 'border-neutral-200'
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={groupOn(group.sources)}
                onChange={() => toggleGroup(group.sources)}
              />
              <span>
                <span className="text-sm font-medium">{group.label}</span>
                <span className="mt-0.5 block text-xs text-neutral-600">
                  {group.sources.map((s) => SOURCE_LABELS[s]).join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-neutral-200 bg-white p-5">
        <legend className="px-1 text-sm font-medium text-neutral-700">
          Period and delivery
        </legend>
        <div className="mt-2 flex flex-wrap gap-4">
          <label>
            <span className="text-sm text-neutral-700">From</span>
            <input
              type="date"
              value={values.windowFrom?.slice(0, 10) ?? ''}
              onChange={(e) => set('windowFrom', e.target.value || null)}
              className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
          <label>
            <span className="text-sm text-neutral-700">To</span>
            <input
              type="date"
              value={values.windowTo?.slice(0, 10) ?? ''}
              onChange={(e) => set('windowTo', e.target.value || null)}
              className="mt-1 block rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Records outside this range are dropped while the file is read, on the
          respondent&apos;s own device. Leave both empty to keep everything they
          share.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={values.exportRawText}
            onChange={(e) => set('exportRawText', e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium">
              Downloads may include what respondents typed
            </span>
            <span className="mt-0.5 block text-xs text-neutral-600">
              On, the export carries queries and AI answers verbatim. Off, it
              carries counts, matches and congruence only. Decide it here rather
              than per download request.
            </span>
          </span>
        </label>
      </fieldset>

      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create study'}
        </button>
        {saved && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </form>
  )
}
