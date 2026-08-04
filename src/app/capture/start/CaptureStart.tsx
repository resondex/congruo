'use client'

import { useState } from 'react'
import ConsentAndRequest from '@/components/ConsentAndRequest'
import type { SourceKind } from '@/lib/records'

interface Props {
  studySlug: string
  respondentId?: string
  sources: SourceKind[]
  disclosureVersion: string
  /** Absent only in previews; a real fielding always returns somewhere. */
  onCompleteUrl: string | null
  onDeclineUrl: string | null
}

export default function CaptureStart({
  studySlug,
  respondentId,
  sources,
  disclosureVersion,
  onCompleteUrl,
  onDeclineUrl,
}: Props) {
  const [error, setError] = useState<string | null>(null)

  /**
   * Records the decision before handing the respondent back. A decline is
   * written too: those sessions are the comparison group that makes
   * donation-selection bias measurable, so losing them would be worse than
   * losing a completion.
   */
  async function submit(granted: SourceKind[], next: string | null) {
    setError(null)
    try {
      const response = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studySlug,
          respondentId,
          disclosureVersion,
          comprehensionPassed: true,
          grants: sources.map((source) => ({
            source,
            granted: granted.includes(source),
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ?? 'Could not record your choices.')
        return
      }
    } catch {
      setError('Could not reach the server. Please try again.')
      return
    }
    if (next) window.location.href = next
  }

  return (
    <>
      {error && (
        <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </p>
      )}
      <ConsentAndRequest
        sources={sources}
        disclosureVersion={disclosureVersion}
        onContinue={(granted) => void submit(granted, onCompleteUrl)}
        onDecline={() => void submit([], onDeclineUrl)}
      />
    </>
  )
}
