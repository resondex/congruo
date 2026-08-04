'use client'

import ConsentAndRequest from '@/components/ConsentAndRequest'
import type { SourceKind } from '@/lib/records'

interface Props {
  sources: SourceKind[]
  disclosureVersion: string
  /** Absent only in previews; a real fielding always returns somewhere. */
  onCompleteUrl: string | null
  onDeclineUrl: string | null
}

export default function CaptureStart({
  sources,
  disclosureVersion,
  onCompleteUrl,
  onDeclineUrl,
}: Props) {
  return (
    <ConsentAndRequest
      sources={sources}
      disclosureVersion={disclosureVersion}
      onContinue={() => {
        // TODO: record grants against the session before handing back.
        if (onCompleteUrl) window.location.href = onCompleteUrl
      }}
      onDecline={() => {
        if (onDeclineUrl) window.location.href = onDeclineUrl
      }}
    />
  )
}
