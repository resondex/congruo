import Link from 'next/link'
import { readInvite } from '@/lib/invites'
import AcceptForm from './AcceptForm'

const ROLE_TEXT: Record<string, string> = {
  staff: 'You will have access to every organisation and study.',
  client_admin: 'You will be able to create and edit studies for',
  client_viewer: 'You will be able to read and download studies for',
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invite = await readInvite(token)

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">
          This invitation is not valid
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          It may have been used already, or expired. Ask whoever invited you to
          send a new one.
        </p>
        <Link
          href="/login"
          className="mt-6 text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Sign in instead
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Set up your account
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Invited as <strong>{invite.email}</strong>.{' '}
        {ROLE_TEXT[invite.role]}
        {invite.orgName ? ` ${invite.orgName}.` : ''}
      </p>
      <AcceptForm token={token} />
    </main>
  )
}
