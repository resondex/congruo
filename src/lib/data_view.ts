import 'server-only'
import { db } from './db'

/**
 * The headline numbers for the data screen.
 *
 * Counted in SQL rather than by pulling rows and reducing them in JavaScript:
 * a fielded study is thousands of records and this is a page someone opens to
 * glance at.
 */

export interface DataOverview {
  qualityRun: number
  sessionsChecked: number
  sessionsFailing: number
  reconciled: number
  comparisonsTotal: number
  comparisonsAgreed: number
  explanations: { explanation: string; count: number }[]
}

export async function dataOverview(slug: string): Promise<DataOverview> {
  const sql = db()

  const [quality, reconcile, explanations] = await Promise.all([
    sql<{ run: number; checked: number; failing: number }[]>`
      select
        count(*)::int as run,
        count(distinct f.session_id)::int as checked,
        count(distinct f.session_id) filter (where not f.passed)::int as failing
      from quality_flags f
      join sessions s on s.id = f.session_id
      where s.study_slug = ${slug}
    `,
    sql<{ sessions: number; total: number; agreed: number }[]>`
      select
        count(distinct r.session_id)::int as sessions,
        count(*)::int as total,
        count(*) filter (where r.agreed)::int as agreed
      from reconcile_responses r
      join sessions s on s.id = r.session_id
      where s.study_slug = ${slug}
    `,
    sql<{ explanation: string; count: number }[]>`
      select r.explanation, count(*)::int as count
      from reconcile_responses r
      join sessions s on s.id = r.session_id
      where s.study_slug = ${slug} and r.explanation is not null
      group by r.explanation order by count desc
    `,
  ])

  return {
    qualityRun: quality[0]?.run ?? 0,
    sessionsChecked: quality[0]?.checked ?? 0,
    sessionsFailing: quality[0]?.failing ?? 0,
    reconciled: reconcile[0]?.sessions ?? 0,
    comparisonsTotal: reconcile[0]?.total ?? 0,
    comparisonsAgreed: reconcile[0]?.agreed ?? 0,
    explanations,
  }
}
