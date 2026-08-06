import Link from 'next/link'
import { readReset } from '@/lib/resets'
import ResetForm from './ResetForm'

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const reset = await readReset(token)

  if (!reset) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">
          This reset link is not valid
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          It may have been used, replaced by a newer one, or expired. Ask an
          admin to send another.
        </p>
        <Link
          href="/login"
          className="mt-6 text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Back to sign in
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        For <strong>{reset.email}</strong>. Everywhere else you are signed in
        will be signed out.
      </p>
      <ResetForm token={token} />
    </main>
  )
}
