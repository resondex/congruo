import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser, canEditStudies } from '@/lib/auth'
import { studyFor } from '@/lib/admin_store'
import { getQuestions } from '@/lib/survey_store'
import QuestionEditor, { type EditableQuestion } from './QuestionEditor'

export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireUser()

  const [summary, questions] = await Promise.all([
    studyFor(user, slug),
    getQuestions(slug),
  ])
  if (!summary) notFound()
  const editable = canEditStudies(user)

  const initial: EditableQuestion[] = questions.map((q) => ({
    code: q.code,
    page: q.page,
    type: q.type,
    prompt: q.prompt,
    help: q.help ?? null,
    options: q.options,
    required: q.required,
    min: q.min ?? null,
    max: q.max ?? null,
    minLabel: q.minLabel ?? null,
    maxLabel: q.maxLabel ?? null,
    claim: (q.claim as unknown as Record<string, unknown>) ?? null,
    showIf: (q.showIf as unknown as Record<string, unknown>) ?? null,
    terminateIf: (q.terminateIf as unknown as Record<string, unknown>) ?? null,
  }))

  return (
    <>
      <Link
        href={`/admin/studies/${slug}`}
        className="text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        ← {summary.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Questions</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        The survey runs while the respondent&apos;s export is being prepared, and
        finishes before they see any of their own records. Questions on the same
        screen number are asked together.
      </p>

      <QuestionEditor
        slug={slug}
        initial={initial}
        readOnly={!editable}
        hasFielded={summary.surveyed > 0}
      />
    </>
  )
}
