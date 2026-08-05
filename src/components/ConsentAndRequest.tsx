'use client'

/**
 * Consent, then fire the export requests.
 *
 * This is the first hop. It runs before the interview so the archives are
 * building while the respondent answers questions, which is the only thing
 * that makes the wait tolerable. See docs/architecture.md.
 *
 * Consent is given per group, not per source: the six Google products arrive
 * in one export, so a checkbox for each decides nothing about what gets
 * downloaded and reads as false precision. Each group lists what it covers,
 * and item-by-item redaction happens at review where the respondent can see
 * the actual records.
 */

import { useEffect, useMemo, useState } from 'react'
import { groupsFor, type SourceGroup, type SourceKind } from '@/lib/records'

/**
 * Two steps, and deliberately no more.
 *
 * Takeout has no URL parameter for the export format, so asking for JSON meant
 * a manual dropdown that most respondents would miss - and missing it used to
 * mean we read nothing at all. The HTML parser now handles Takeout's default
 * completely, so the step is gone. Every instruction we delete is a place the
 * flow stops failing.
 *
 * We also no longer ask them to narrow the product list. Anything we do not
 * read is discarded during parsing and never reaches the review screen, so
 * narrowing only shrinks their download - not worth the most error-prone tap
 * on a phone.
 */
const REQUEST_HINTS: Record<string, string[]> = {
  Google: [
    'My Activity is already selected for you. Leave everything else alone.',
    'Scroll down, press "Next step", then "Create export".',
  ],
  ChatGPT: [
    'Settings, then Data controls, then Export data.',
    'OpenAI emails you a link. The file you want is the .zip.',
  ],
}

interface Props {
  sources: SourceKind[]
  disclosureVersion: string
  /** Called once the respondent has consented and started their exports. */
  onContinue: (granted: SourceKind[]) => void
  onDecline: () => void
}

/** One download, however many groups it satisfies. */
interface Export {
  name: string
  url: string
  groups: SourceGroup[]
}

export default function ConsentAndRequest({
  sources,
  disclosureVersion,
  onContinue,
  onDecline,
}: Props) {
  const groups = useMemo(() => groupsFor(sources), [sources])

  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [understood, setUnderstood] = useState(false)
  /** They tapped the link. Says nothing about whether they finished. */
  const [opened, setOpened] = useState<Set<string>>(new Set())
  /** They came back and told us the export actually started. */
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [cameBack, setCameBack] = useState(false)

  /**
   * On a phone, tapping an export link takes them out of our tab entirely and
   * any instructions on this page go with it. We cannot follow them there - the
   * vendor forbids framing, and wrapping their Google login in our chrome would
   * be the wrong thing to do even if it were possible. So the guidance meets
   * them on the way back instead.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setCameBack(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  /**
   * Requests are per download, not per group. Search activity and Gemini are
   * separate decisions but one Takeout export, and asking someone to request
   * the same file twice is how you lose them.
   */
  const exports: Export[] = useMemo(() => {
    const byUrl = new Map<string, Export>()
    for (const group of groups) {
      if (!granted.has(group.id)) continue
      const found = byUrl.get(group.exportUrl)
      if (found) found.groups.push(group)
      else
        byUrl.set(group.exportUrl, {
          name: group.exportName,
          url: group.exportUrl,
          groups: [group],
        })
    }
    return [...byUrl.values()]
  }, [groups, granted])

  const anyGranted = granted.size > 0
  // Tapping a link is not evidence of anything. Requiring them to say the
  // export started is the difference between a real gate and a decorative one.
  const allConfirmed = exports.every((e) => confirmed.has(e.url))
  const awaitingConfirmation = exports.filter(
    (e) => opened.has(e.url) && !confirmed.has(e.url)
  )

  const toggle = (id: string) =>
    setGranted((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Grants stay per source: the group is how it was asked, not what it covers. */
  const grantedSources = () =>
    groups.filter((g) => granted.has(g.id)).flatMap((g) => g.sources)

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">
        Before we start, what may we see?
      </h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        You choose each one separately, and you can take part with none of them
        selected. Later you will see exactly what your file contains and decide
        what to send.
      </p>

      <ul className="mt-8 space-y-3">
        {groups.map((group) => (
          <li key={group.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 transition hover:border-neutral-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={granted.has(group.id)}
                onChange={() => toggle(group.id)}
              />
              <span>
                <span className="font-medium">{group.label}</span>
                <ul className="mt-2 space-y-1 text-sm text-neutral-600">
                  {group.includes.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden className="text-neutral-300">
                        —
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <span className="mt-2 block text-xs text-neutral-500">
                  Opened on your own device. You review it and choose what to
                  send before anything reaches us.
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
            {exports.length === 1
              ? 'This takes a few minutes to prepare, so start it now and carry on with the questions while it runs.'
              : 'Each of these takes a few minutes to prepare, so start them now and carry on with the questions while they run.'}
          </p>
          <ul className="mt-4 space-y-5">
            {exports.map((item) => (
              <li key={item.url}>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      setOpened((prev) => new Set(prev).add(item.url))
                    }
                    className="rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white"
                  >
                    {opened.has(item.url) ? 'Open again' : 'Request'} your{' '}
                    {item.name} data
                  </a>
                  {confirmed.has(item.url) && (
                    <span className="text-xs font-medium text-green-700">
                      Confirmed
                    </span>
                  )}
                </div>
                {item.groups.length > 1 && (
                  <p className="mt-2 text-xs text-neutral-600">
                    One download covers{' '}
                    {item.groups.map((g) => g.label).join(' and ')}.
                  </p>
                )}
                {REQUEST_HINTS[item.name] && !confirmed.has(item.url) && (
                  <ol className="mt-2 ml-1 list-inside list-decimal space-y-1 text-xs leading-relaxed text-neutral-600">
                    {REQUEST_HINTS[item.name].map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Shown as soon as an export has been opened, not gated on a return
        event. visibilitychange varies by browser and does not fire at all if
        they open the link in the same tab and use the back button; a gate that
        silently never opens would strand them. Coming back only changes the
        wording.
      */}
      {awaitingConfirmation.length > 0 && (
        <div className="mt-8 rounded-lg border border-neutral-900 bg-white p-5 shadow-sm">
          <h2 className="font-medium">
            {cameBack ? 'Welcome back. Did it start?' : 'Did it start?'}
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Tick each export you managed to set going. If one did not work, open
            it again and follow the steps above.
          </p>
          <ul className="mt-4 space-y-2">
            {awaitingConfirmation.map((item) => (
              <li key={item.url}>
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    onChange={() =>
                      setConfirmed((prev) => new Set(prev).add(item.url))
                    }
                  />
                  <span>I started my {item.name} export</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-5">
        <button
          type="button"
          disabled={!anyGranted || !understood || !allConfirmed}
          onClick={() => onContinue(grantedSources())}
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
