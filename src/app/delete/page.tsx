import DeleteForm from './DeleteForm'

/**
 * Where a respondent comes to be forgotten.
 *
 * No account, because they never had one. The reference they were given at the
 * end is the whole of the credential.
 */
export default async function DeletePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Remove what you shared
      </h1>
      <p className="mt-3 max-w-prose text-neutral-600">
        When you finished, you were given a reference. Paste it here and we will
        show you what we hold before anything is removed.
      </p>
      <DeleteForm initialToken={token ?? ''} />
      <p className="mt-10 max-w-prose text-sm text-neutral-500">
        Lost the reference? We cannot look you up without it - we hold no name,
        address or account for you, which is deliberate and is also why we
        cannot find your records from anything else. Write to us and we will
        explain what can be done.
      </p>
    </main>
  )
}
