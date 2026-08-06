import { redirect } from 'next/navigation'
import { requireUser, canEditStudies } from '@/lib/auth'
import { orgsFor } from '@/lib/admin_store'
import StudyForm from '../StudyForm'

export default async function NewStudyPage() {
  const user = await requireUser()
  if (!canEditStudies(user)) redirect('/admin')

  const orgs = await orgsFor(user)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">New study</h1>
      <p className="mt-1 max-w-prose text-sm text-neutral-600">
        This creates the link respondents will use. The questions come next.
      </p>
      <StudyForm
        existing={false}
        canChooseOrg={user.role === 'staff'}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
        initial={{
          slug: '',
          name: '',
          mode: 'full_service',
          orgId: user.role === 'staff' ? null : user.orgId,
          sources: [
            'google_search',
            'google_ai_mode',
            'google_image_search',
            'google_video_search',
            'google_hotels',
            'google_shopping',
          ],
          returnHosts: [],
          defaultReturnUrl: null,
          windowFrom: null,
          windowTo: null,
          exportRawText: true,
        }}
      />
    </>
  )
}
