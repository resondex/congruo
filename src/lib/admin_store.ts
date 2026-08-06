import 'server-only'
import { db } from './db'
import { canSeeOrg, type User } from './auth'

/**
 * Reads for the admin surface, every one of them scoped to what the caller may
 * see.
 *
 * The scoping is in the SQL rather than applied to the result, so a mistake is
 * an empty page instead of a leak. There is no "fetch all studies" function to
 * accidentally call: the only way to get a study is to pass the user asking.
 */

export interface StudySummary {
  slug: string
  name: string
  mode: 'full_service' | 'append'
  orgId: string | null
  orgName: string | null
  sources: string[]
  exportRawText: boolean
  createdAt: string
  questionCount: number
  /** Sessions that reached us at all. */
  started: number
  surveyed: number
  released: number
  declined: number
  screenedOut: number
  reconciled: number
  records: number
}

interface Row {
  slug: string
  name: string
  mode: 'full_service' | 'append'
  org_id: string | null
  org_name: string | null
  sources: string[]
  export_raw_text: boolean
  created_at_admin: string
  question_count: string
  started: string
  surveyed: string
  released: string
  declined: string
  screened_out: string
  reconciled: string
  records: string
}

const toSummary = (r: Row): StudySummary => ({
  slug: r.slug,
  name: r.name,
  mode: r.mode,
  orgId: r.org_id,
  orgName: r.org_name,
  sources: r.sources ?? [],
  exportRawText: r.export_raw_text,
  createdAt: r.created_at_admin,
  questionCount: Number(r.question_count),
  started: Number(r.started),
  surveyed: Number(r.surveyed),
  released: Number(r.released),
  declined: Number(r.declined),
  screenedOut: Number(r.screened_out),
  reconciled: Number(r.reconciled),
  records: Number(r.records),
})

/**
 * Studies the user may see, with their headline counts.
 *
 * Staff see every study including the unowned development ones. A client sees
 * exactly their org's, and a client with no org sees none - the check fails
 * closed, because the cost of the other direction is one client reading
 * another's respondents.
 */
export async function studiesFor(user: User): Promise<StudySummary[]> {
  const sql = db()
  const scoped = user.role === 'staff'
  // A client with no org would otherwise match `org_id is null` and be handed
  // the unowned studies. Match on a value that cannot exist instead.
  const orgId = user.orgId ?? '00000000-0000-0000-0000-000000000000'

  const rows = await sql<Row[]>`
    select
      s.slug, s.name, s.mode, s.org_id, o.name as org_name, s.sources,
      s.export_raw_text, s.created_at_admin,
      (select count(*) from survey_questions q where q.study_slug = s.slug) as question_count,
      (select count(*) from sessions x where x.study_slug = s.slug) as started,
      (select count(*) from sessions x where x.study_slug = s.slug and x.survey_done_at is not null) as surveyed,
      (select count(*) from sessions x where x.study_slug = s.slug and x.released_at is not null) as released,
      (select count(*) from sessions x where x.study_slug = s.slug and x.declined_at is not null) as declined,
      (select count(*) from sessions x where x.study_slug = s.slug and x.screened_out_at is not null) as screened_out,
      (select count(*) from sessions x where x.study_slug = s.slug and x.reconciled_at is not null) as reconciled,
      (select count(*) from released_records r
         join sessions x on x.id = r.session_id
        where x.study_slug = s.slug) as records
    from studies s
    left join orgs o on o.id = s.org_id
    where ${scoped ? sql`true` : sql`s.org_id = ${orgId}`}
    order by s.created_at_admin desc, s.slug
  `
  return rows.map(toSummary)
}

/** One study, or null when the user may not see it. Same scoping, one row. */
export async function studyFor(
  user: User,
  slug: string
): Promise<StudySummary | null> {
  const all = await studiesFor(user)
  const found = all.find((s) => s.slug === slug)
  if (!found) return null
  // Belt and braces: the query above already scoped, and this re-checks the
  // answer against the same rule used everywhere else.
  return canSeeOrg(user, found.orgId) ? found : null
}

export interface OrgRow {
  id: string
  name: string
  slug: string
  studies: number
  users: number
}

export async function orgsFor(user: User): Promise<OrgRow[]> {
  const sql = db()
  if (user.role !== 'staff') {
    if (!user.orgId) return []
    return sql<OrgRow[]>`
      select o.id, o.name, o.slug,
        (select count(*) from studies s where s.org_id = o.id)::int as studies,
        (select count(*) from users u where u.org_id = o.id)::int as users
      from orgs o where o.id = ${user.orgId}
    `
  }
  return sql<OrgRow[]>`
    select o.id, o.name, o.slug,
      (select count(*) from studies s where s.org_id = o.id)::int as studies,
      (select count(*) from users u where u.org_id = o.id)::int as users
    from orgs o order by o.name
  `
}
