import ReviewAndRelease from '@/components/ReviewAndRelease'
import { buildReturnUrl, readCaptureParams } from '@/lib/studies'

/**
 * Second hop of an append fielding.
 *
 * The respondent comes back once their interview is done and their archive is
 * ready. They review, release, and are returned to the referring platform with
 * a status. There is no reconcile step here: we never see their answers, so we
 * have nothing to put to them.
 */
export default async function CaptureReleasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await readCaptureParams(await searchParams)

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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ReviewAndRelease
        studySlug={study.slug}
        respondentId={respondentId}
        window={{
          from: study.window?.from ? new Date(study.window.from) : undefined,
          to: study.window?.to ? new Date(study.window.to) : undefined,
        }}
        returnTo={
          returnUrl
            ? {
                complete: buildReturnUrl(
                  study,
                  returnUrl,
                  respondentId,
                  'complete'
                ),
                declined: buildReturnUrl(
                  study,
                  returnUrl,
                  respondentId,
                  'declined'
                ),
              }
            : undefined
        }
      />
    </main>
  )
}
