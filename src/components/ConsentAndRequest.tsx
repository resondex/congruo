'use client'

/**
 * Consent, then fire the export requests.
 *
 * This is the first hop. It runs before the interview so the archives are
 * building while the respondent answers questions, which is the only thing
 * that makes the wait tolerable. See docs/architecture.md.
 */

import { useState } from 'react'
import { SOURCE_LABELS, type SourceKind } from '@/lib/records'

/**
 * Where each vendor's export lives. These drift; when one moves, the symptom
 * is a respondent landing on a settings page with no export button.
 */
const EXPORT_URLS: Record<SourceKind, string> = {
  google_search: 'https://takeout.google.com/',
  gemini: 'https://takeout.google.com/',
  chatgpt: 'https://chatgpt.com/#settings/DataControls',
  claude: 'https://claude.ai/settings/data-privacy-controls',
  perplexity: 'https://www.perplexity.ai/settings/account',
}

/**
 * Steps, not prose. Takeout in particular defaults to every Google product,
 * and two of its entries are easy to confuse: "My Activity" is what we read,
 * while "Access log activity" is account security data - IP addresses, devices,
 * sign-in times. We never read it and nobody should be downloading it for us.
 *
 * Narrowing inside My Activity matters too. We only ever parse Search and
 * Gemini, so anything else in there is downloaded and never used.
 */
const REQUEST_HINTS: Partial<Record<SourceKind, string[]>> = {
  google_search: [
    'Press "Deselect all" at the top.',
    'Tick "My Activity" only. Leave "Access log activity" unticked - that is sign-in and device data, and we do not read it.',
    'Open "All activity data included" and deselect everything except Search and Gemini.',
    'Set the format to JSON, not HTML.',
  ],
  gemini: ['Comes in the same Google export as your search history.'],
  chatgpt: [
    'Settings, then Data controls, then Export data.',
    'OpenAI will email you a link. The file you want is the .zip it gives you.',
  ],
}

interface Props {
  sources: SourceKind[]
  disclosureVersion: string
  /** Called once the respondent has consented and started their exports. */
  onContinue: (granted: SourceKind[]) => void
  onDecline: () => void
}

export default function ConsentAndRequest({
  sources,
  disclosureVersion,
  onContinue,
  onDecline,
}: Props) {
  const [granted, setGranted] = useState<Set<SourceKind>>(new Set())
  const [understood, setUnderstood] = useState(false)
  const [requested, setRequested] = useState<Set<SourceKind>>(new Set())

  const anyGranted = granted.size > 0
  const allRequested = [...granted].every((s) => requested.has(s))

  const toggle = (source: SourceKind) =>
    setGranted((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">
        Before we start, what may we see?
      </h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        You choose each one separately, and you can take part with none of them
        selected. Later you will see exactly what your file contains and decide
        item by item what to send.
      </p>

      <ul className="mt-8 space-y-3">
        {sources.map((source) => (
          <li key={source}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={granted.has(source)}
                onChange={() => toggle(source)}
              />
              <span>
                <span className="font-medium">{SOURCE_LABELS[source]}</span>
                <span className="mt-1 block text-sm text-neutral-600">
                  Your own history, which you will review before anything is
                  sent.
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={understood}
          onChange={() => setUnderstood((v) => !v)}
        />
        <span className="text-neutral-700">
          I understand that my history is opened on my own device, that I choose
          what is sent, and that I can ask for it to be deleted at any time.
        </span>
      </label>

      {anyGranted && understood && (
        <div className="mt-10 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
          <h2 className="font-medium">Now ask for your data</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Each of these takes a few minutes to prepare, so start them now and
            carry on with the questions while they run.
          </p>
          <ul className="mt-4 space-y-5">
            {[...granted].map((source) => (
              <li key={source}>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={EXPORT_URLS[source]}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setRequested((prev) => new Set(prev).add(source))
                    }
                    className="rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white"
                  >
                    Request {SOURCE_LABELS[source]}
                  </a>
                  {requested.has(source) && (
                    <span className="text-xs font-medium text-green-700">
                      Started
                    </span>
                  )}
                </div>
                {REQUEST_HINTS[source] && (
                  <ol className="mt-2 ml-1 list-inside list-decimal space-y-1 text-xs leading-relaxed text-neutral-600">
                    {REQUEST_HINTS[source].map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-5">
        <button
          type="button"
          disabled={!anyGranted || !understood || !allRequested}
          onClick={() => onContinue([...granted])}
          className="rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white disabled:opacity-40"
        >
          Continue to the questions
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Continue without sharing anything
        </button>
      </div>

      <p className="mt-6 text-xs text-neutral-400">
        Disclosure version {disclosureVersion}
      </p>
    </section>
  )
}
