import Link from 'next/link'
import ForgotForm from './ForgotForm'

export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Tell us the address you sign in with and we will send a link.
      </p>
      <ForgotForm />
      <Link
        href="/login"
        className="mt-6 text-sm text-neutral-500 underline hover:text-neutral-900"
      >
        Back to sign in
      </Link>
    </main>
  )
}
