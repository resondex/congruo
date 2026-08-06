'use client'

export default function SignOut() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        // A full navigation, not a router push. The session cookie has just
        // been cleared and every page behind this reads it on the server; a
        // client-side transition would render the signed-in shell from cache.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login'
      }}
      className="text-neutral-500 underline hover:text-neutral-900"
    >
      Sign out
    </button>
  )
}
