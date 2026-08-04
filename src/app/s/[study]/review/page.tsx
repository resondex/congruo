import ReviewAndRelease from '@/components/ReviewAndRelease'
import { getStudy } from '@/lib/studies'

/**
 * Review step of a full-service fielding.
 *
 * The study comes from the URL, not from the environment: one deployment runs
 * many studies, and which one a respondent belongs to is a property of the link
 * they were sent, not of the build.
 *
 * No return targets here - in full-service mode the respondent stays with us
 * and goes on to the reconcile module.
 */
export default async function StudyReviewPage({
  params,
}: {
  params: Promise<{ study: string }>
}) {
  const { study: slug } = await params
  const study = await getStudy(slug)

  if (!study) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-xl font-semibold">This link is not valid</h1>
        <p className="mt-2 text-neutral-600">
          We could not find that study. Please check the link you were sent.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <ReviewAndRelease
        studySlug={study.slug}
        window={{
          from: study.window?.from ? new Date(study.window.from) : undefined,
          to: study.window?.to ? new Date(study.window.to) : undefined,
        }}
      />
    </main>
  )
}
