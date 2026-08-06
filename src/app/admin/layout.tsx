import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import SignOut from './SignOut'

/**
 * The signed-in shell.
 *
 * The guard is here rather than in middleware so it runs against the database
 * on every admin page: a disabled account or a revoked session stops working
 * immediately rather than at the end of a cookie's life.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await currentUser()
  if (!user) redirect('/login?next=/admin')

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            Congruo
          </Link>
          <nav className="flex gap-4 text-sm text-neutral-600">
            <Link href="/admin" className="hover:text-neutral-900">
              Studies
            </Link>
            {user.role === 'staff' && (
              <Link href="/admin/orgs" className="hover:text-neutral-900">
                Organisations
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-neutral-500">
              {user.email}
              {user.orgName ? ` · ${user.orgName}` : ' · staff'}
            </span>
            <SignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  )
}
