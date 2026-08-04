# Congruo

A survey instrument that measures the congruence between what people say they do
and what their own search and AI history shows they did.

Respondents answer first, then release their own records. The gap between the two
is the measurement, and where the two diverge the respondent explains it in the
same session.

> **Status: pre-alpha.** Nothing is deployed, no data is being collected, and the
> name is provisional pending trademark clearance.

## The sequence

| Stage | What happens | What it yields |
| --- | --- | --- |
| **Prime** | The data request is fired before any question is asked | Starts the archive building, so the wait has somewhere to go |
| **Ask** | The survey runs while the archive builds | Self-report captured before the respondent has seen any record |
| **Ground** | History arrives; the respondent reviews, redacts, and releases it | Observed behavior for the same respondent |
| **Reconcile** | Divergences are put to the respondent while they are still in session | The explanation, in their own words |

The ordering is the method, not a convenience. Because the survey completes before
the release, self-report stays uncontaminated by the record. And because survey
data is retained for respondents who decline to release, donation-selection bias
can be measured directly rather than estimated.

## Two modes

**Full service.** We run the whole thing: consent, request, survey, review,
release, reconcile. Entry point is `/`.

**Append.** The client runs the interview on their own survey platform and sends
the respondent to us twice: once at the top to consent and start their exports
building, and once at the end to review and release. We return them with a status
each time. There is no reconcile step, because we never see their answers.

```
their survey starts
  -> /capture/start   consent, fire the export requests
  <- back to their survey, which fills the wait
  -> /capture/release review, redact, release
  <- back to their survey for the closing screen
```

Records are keyed to the referring platform's own respondent id, which is the
only join key between our file and theirs. We hold nothing else identifying, so
our data is inert to anyone who does not already have their survey file.

The status we hand back is `complete`, `declined`, `partial`, or `error`.
**`declined` must stay distinct from `error`**: in append mode the client holds
the survey data, so telling them who chose not to release is the only way they
can measure donation-selection bias on their own file.

Return URLs arrive in the query string and are checked against a per-study host
allowlist. They are never trusted as given.

## The constraint that shapes the codebase

**Archives are parsed and redacted client-side. The raw archive never touches the
server.**

The zip goes from the device's file picker into the browser, unzips and parses in
the tab, renders for review, and only the records the respondent explicitly
releases are ever sent to the server.

This is not an optimization. "We only ever received what they released" stops
being true the moment the server accepts an upload and parses it. Practically it
means:

- Parsers are browser JavaScript, not server routes
- Intake is `<input type="file">`, not a signed upload URL
- No API route may accept an archive, now or later

## Sources

| Source | Method | Notes |
| --- | --- | --- |
| Google search history | Takeout export | The Data Portability API would automate this, but it is not available to US users |
| Gemini activity | Takeout export | Same |
| ChatGPT, Claude, Perplexity | Respondent's own account export | No third-party API exists for consumer conversation history |

The Data Portability API is currently limited to the EEA, Switzerland, and the UK.
A UK or EU deployment could authorize and return inside the session; the US build
uses assisted export throughout.

## Consent model

- Grants are per source, on their own screen, with a comprehension check
- Scopes are named and windows are bounded to the study period
- Redaction happens on the respondent's device, before transmission
- Release is an explicit act, and the respondent receives a receipt of what went
- Deletion reaches raw archives, derived tables, and backups on a stated clock

## Stack

Next.js (App Router) · Postgres on Supabase · Vercel

We connect straight to Postgres rather than through the Supabase Data API; see
`docs/architecture.md` for why. Apply migrations with `npm run migrate`.

## Development

```bash
npm install
cp .env.example .env.local   # fill in your own keys
npm run dev
```

Use synthetic fixtures for development. Do not commit real exports; see the first
block of `.gitignore`.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — design decisions and their reasoning

## License

Not yet licensed. All rights reserved pending a decision.
