import { requireUser } from '@/lib/auth'
import { passkeysFor } from '@/lib/passkeys'
import Passkeys from './Passkeys'

export default async function AccountPage() {
  const user = await requireUser()
  const keys = await passkeysFor(user.id)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {user.email}
        {user.orgName ? ` · ${user.orgName}` : ' · staff'}
      </p>
      <Passkeys initial={keys} />
    </>
  )
}
