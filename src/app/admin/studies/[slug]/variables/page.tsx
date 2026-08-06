import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser, canEditStudies } from '@/lib/auth'
import { studyFor } from '@/lib/admin_store'
import { getQuestions } from '@/lib/survey_store'
import { variablesFor } from '@/lib/variables_store'
import { isAnswerable } from '@/lib/survey'
import VariableEditor, { type EditableVariable } from './VariableEditor'

export default async function VariablesPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const user = await requireUser()

  const [summary, questions, variables] = await Promise.all([
    studyFor(user, slug),
    getQuestions(slug),
    variablesFor(slug),
  ])
  if (!summary) notFound()

  const initial: EditableVariable[] = variables.map((v) => ({
    name: v.name,
    label: v.label ?? null,
    kind: v.kind,
    sourceParam: v.sourceParam ?? null,
    rule: (v.rule as EditableVariable['rule']) ?? null,
  }))

  return (
    <>
      <Link
        href={`/admin/studies/${slug}`}
        className="text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        ← {summary.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Variables</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        Columns in the delivered file that nobody is asked for. One kind arrives
        on the link - sample source, quota cell, your own identifiers. The other
        is computed from the answers: nets, segments, banner points.
      </p>

      <VariableEditor
        slug={slug}
        initial={initial}
        readOnly={!canEditStudies(user)}
        // Only answerable questions can be referred to; a heading has no answer
        // for a rule to test.
        questions={questions
          .filter((q) => isAnswerable(q.type))
          .map((q) => ({ code: q.code, options: q.options }))}
      />
    </>
  )
}
