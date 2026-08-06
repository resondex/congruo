import type { NextRequest } from 'next/server'
import { dbConfigured, db } from '@/lib/db'
import { currentUser, canEditStudies, canSeeOrg } from '@/lib/auth'
import { isCondition } from '@/lib/conditions'
import { getQuestions } from '@/lib/survey_store'

/**
 * Replaces a study's variables, all at once.
 *
 * Same reasoning as the questions endpoint: a derived rule names questions by
 * code, so saving one variable at a time would let a study sit with a rule
 * pointing at something that is not there yet.
 */

interface VariableInput {
  name: string
  label: string | null
  kind: 'hidden' | 'derived'
  sourceParam: string | null
  rule: unknown
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'Expected JSON.' }, { status: 415 })
  }
  if (!dbConfigured()) {
    return Response.json({ error: 'Not configured.' }, { status: 503 })
  }
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 })
  if (!canEditStudies(user)) {
    return Response.json({ error: 'You cannot change studies.' }, { status: 403 })
  }

  const { slug } = await params
  const sql = db()
  const found = await sql<{ org_id: string | null }[]>`
    select org_id from studies where slug = ${slug} limit 1
  `
  if (!found.length) return Response.json({ error: 'No such study.' }, { status: 400 })
  if (!canSeeOrg(user, found[0].org_id)) {
    return Response.json({ error: 'That study is not yours.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON.' }, { status: 400 })
  }
  const { variables } = (body ?? {}) as Record<string, unknown>
  if (!Array.isArray(variables)) {
    return Response.json({ error: 'variables must be an array.' }, { status: 400 })
  }

  // A variable and a question both become a column, so one name cannot be both.
  const questionCodes = new Set((await getQuestions(slug)).map((q) => q.code))
  const seen = new Set<string>()
  const parsed: VariableInput[] = []

  for (const raw of variables) {
    const { name, label, kind, sourceParam, rule } = (raw ?? {}) as Record<string, unknown>

    if (typeof name !== 'string' || !/^[a-z0-9_]{2,60}$/.test(name)) {
      return Response.json(
        { error: `"${String(name)}" is not a usable name. Lowercase letters, numbers and underscores.` },
        { status: 400 }
      )
    }
    if (questionCodes.has(name)) {
      return Response.json(
        { error: `A question already uses the name ${name}.` },
        { status: 400 }
      )
    }
    if (seen.has(name)) {
      return Response.json({ error: `Two variables share the name ${name}.` }, { status: 400 })
    }
    seen.add(name)

    if (kind !== 'hidden' && kind !== 'derived') {
      return Response.json({ error: `${name} has an unknown kind.` }, { status: 400 })
    }
    if (kind === 'hidden') {
      if (typeof sourceParam !== 'string' || !sourceParam.trim()) {
        return Response.json(
          { error: `${name} needs the query parameter it is read from.` },
          { status: 400 }
        )
      }
    } else {
      const r = rule as { buckets?: unknown; otherwise?: unknown } | null
      if (!r || !Array.isArray(r.buckets)) {
        return Response.json({ error: `${name} has no rules.` }, { status: 400 })
      }
      for (const bucket of r.buckets) {
        const { code, label: bl, when } = (bucket ?? {}) as Record<string, unknown>
        if (typeof code !== 'number' || !Number.isInteger(code)) {
          return Response.json({ error: `${name} has a rule with no value.` }, { status: 400 })
        }
        if (typeof bl !== 'string') {
          return Response.json({ error: `${name} has a rule with no label.` }, { status: 400 })
        }
        // Refused rather than stored: a malformed condition would not error at
        // runtime, it would simply never match, and a variable that is always
        // empty looks like nobody qualifying.
        if (!isCondition(when)) {
          return Response.json(
            { error: `${name} has a rule whose condition is not valid.` },
            { status: 400 }
          )
        }
      }
    }

    parsed.push({
      name,
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      kind,
      sourceParam: kind === 'hidden' ? (sourceParam as string).trim() : null,
      rule: kind === 'derived' ? rule : null,
    })
  }

  await sql.begin(async (tx) => {
    await tx`delete from study_variables where study_slug = ${slug}`
    if (!parsed.length) return
    await tx`
      insert into study_variables ${tx(
        parsed.map((v, i) => ({
          study_slug: slug,
          name: v.name,
          label: v.label,
          kind: v.kind,
          source_param: v.sourceParam,
          rule: v.rule ? tx.json(v.rule as never) : null,
          position: i + 1,
        }))
      )}
    `
  })

  return Response.json({ ok: true, saved: parsed.length })
}
