import { buildReturnUrl, readCaptureParams } from '@/lib/studies'
import CaptureStart from './CaptureStart'

/**
 * First hop of an append fielding.
 *
 * The referring platform sends the respondent here at the top of its survey.
 * We take consent, start the exports building, and hand them straight back so
 * the interview fills the wait.
 */
export default async function CaptureStartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = readCaptureParams(await searchParams)

  if ('error' in params) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-xl font-semibold">This link is not valid</h1>
        <p className="mt-2 text-neutral-600">{params.error}</p>
      </main>
    )
  }

  const { study, respondentId, returnUrl } = params

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <CaptureStart
        studySlug={study.slug}
        respondentId={respondentId || undefined}
        sources={study.sources}
        disclosureVersion={
          process.env.NEXT_PUBLIC_DISCLOSURE_VERSION ?? 'unversioned'
        }
        onCompleteUrl={
          returnUrl
            ? buildReturnUrl(study, returnUrl, respondentId, 'complete')
            : null
        }
        onDeclineUrl={
          returnUrl
            ? buildReturnUrl(study, returnUrl, respondentId, 'declined')
            : null
        }
      />
    </main>
  )
}
