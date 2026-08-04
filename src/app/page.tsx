import Link from 'next/link'

const STAGES = [
  {
    name: 'Request',
    detail:
      'You ask Google and any AI services you use for a copy of your own history. This starts first because it takes a few minutes to prepare.',
  },
  {
    name: 'Answer',
    detail:
      'You complete the survey while that copy is being prepared. We ask before you see any of your own records.',
  },
  {
    name: 'Review',
    detail:
      'Your file opens on your own device. You go through it and decide, item by item, what we may keep.',
  },
  {
    name: 'Release',
    detail:
      'Only what you chose is sent. You get a receipt showing exactly what went, and what you held back.',
  },
]

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
        Congruo
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        A study about what people search for, and what they say they search for
      </h1>
      <p className="mt-4 text-neutral-600">
        Most research asks people to remember their own behaviour. This study
        asks, and then invites you to check the answer against your own records.
        You decide what we see.
      </p>

      <ol className="mt-12 space-y-6">
        {STAGES.map((stage, index) => (
          <li key={stage.name} className="flex gap-4">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium tabular-nums text-white">
              {index + 1}
            </span>
            <div>
              <h2 className="font-medium">{stage.name}</h2>
              <p className="mt-1 text-sm text-neutral-600">{stage.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-700">
        <p className="font-medium text-neutral-900">Nothing is sent silently.</p>
        <p className="mt-1">
          Your history file is opened on your own device, not on our servers. It
          reaches us only after you have read it and pressed release, and you
          can ask us to delete everything at any point.
        </p>
      </div>

      <Link
        href="/s/dev/review"
        className="mt-10 inline-block rounded-md bg-neutral-900 px-5 py-2.5 font-medium text-white"
      >
        See the review step (dev study)
      </Link>
      <p className="mt-3 text-xs text-neutral-500">
        Pre-alpha. The consent, request, and survey steps are not built yet.
      </p>
    </main>
  )
}
