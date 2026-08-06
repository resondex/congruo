import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import LoginForm from './LoginForm'

/**
 * Sign-in, for the people who run studies.
 *
 * Respondents never come here. Their whole journey is an unauthenticated link,
 * and it must stay that way.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  if (await currentUser()) redirect('/admin')

  // Only same-origin paths. A `next` of https://elsewhere/ would turn the
  // login page into an open redirect that arrives with a fresh session.
  const target = next && /^\/(?!\/)/.test(next) ? next : '/admin'

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Congruo</h1>
      <p className="mt-2 text-sm text-neutral-600">
        For the people running studies. If you were sent a link to take part,
        you do not need an account - use that link instead.
      </p>
      <LoginForm next={target} />
    </main>
  )
}
