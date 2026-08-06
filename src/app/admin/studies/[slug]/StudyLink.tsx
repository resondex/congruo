'use client'

import { useState } from 'react'

/**
 * The link a respondent is sent.
 *
 * The origin comes from the server rather than from window, which is what this
 * did first: the server rendered "/s/dev" and the browser rendered
 * "http://localhost:3300/s/dev", and React threw out the tree and rebuilt it.
 * Reading the request host on the server gives both sides the same string, and
 * still carries whatever host the deployment is actually being used under.
 */
export default function StudyLink({
  slug,
  mode,
  origin,
}: {
  slug: string
  mode: 'full_service' | 'append'
  origin: string
}) {
  const [copied, setCopied] = useState(false)
  const url =
    mode === 'append'
      ? `${origin}/capture/start?study=${slug}&rid=RESPONDENT_ID&return=YOUR_RETURN_URL`
      : `${origin}/s/${slug}`

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {mode === 'append' ? 'First hop, from your survey' : 'Respondent link'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 overflow-x-auto rounded bg-neutral-50 px-3 py-2 text-xs">
          {url}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
          }}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:border-neutral-500"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {mode === 'append' && (
        <p className="mt-2 text-xs text-neutral-500">
          Replace RESPONDENT_ID with your own id for the person and
          YOUR_RETURN_URL with where to send them back. At the end of your
          interview, send them to /capture/release with the same id.
        </p>
      )}
    </div>
  )
}
