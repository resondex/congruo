import StudyFlow from '@/components/StudyFlow'
import { getStudy } from '@/lib/studies'
import { getQuestions } from '@/lib/survey_store'

/**
 * Entry point for a full-service fielding: the whole flow behind one link.
 *
 * Append-mode studies are not served here. Their interview lives on the
 * client's own platform, so they arrive through /capture/start instead, and
 * sending them down this path would give them a survey step that is not theirs.
 */
export default async function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ study: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { study: slug } = await params
  const search = await searchParams
  const study = await getStudy(slug)

  if (!study || study.mode !== 'full_service') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-xl font-semibold">This link is not valid</h1>
        <p className="mt-2 text-neutral-600">
          We could not find that study. Please check the link you were sent.
        </p>
      </main>
    )
  }

  const questions = await getQuestions(study.slug)

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <StudyFlow
        studySlug={study.slug}
        studyName={study.name}
        sources={study.sources}
        questions={questions}
        query={Object.fromEntries(
          Object.entries(search).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')])
        )}
        disclosureVersion={
          process.env.NEXT_PUBLIC_DISCLOSURE_VERSION ?? 'unversioned'
        }
        window={{
          from: study.window?.from ? new Date(study.window.from) : undefined,
          to: study.window?.to ? new Date(study.window.to) : undefined,
        }}
      />
    </main>
  )
}
