'use client'

import { useState } from 'react'
import ReviewAndRelease from '@/components/ReviewAndRelease'

/**
 * Standalone review, for a full-service study where we are also running the
 * interview. No return targets: the respondent stays with us and goes on to
 * the reconcile module.
 */
export default function ReviewPage() {
  const [sessionId] = useState(() => crypto.randomUUID())

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ReviewAndRelease
        sessionId={sessionId}
        studySlug={process.env.NEXT_PUBLIC_STUDY_ID ?? 'dev'}
      />
    </main>
  )
}
