@AGENTS.md

# Congruo

A survey instrument that measures congruence between what respondents say they
do and what their own search and AI history shows. Read `docs/architecture.md`
before changing anything structural.

## Invariants

These are not preferences. Each one exists because breaking it silently voids a
claim the product is sold on.

**1. Archives are parsed in the browser. The server never receives one.**

Parsing lives in `src/lib/parsers/` and runs client-side. `POST /api/release`
accepts released records as JSON and rejects any other content type.

Do not add a file-upload route, a `multipart/form-data` handler, or a
"just parse it server-side, it's simpler" refactor. The consent claim is that we
only ever received what the respondent reviewed and released; an upload makes
that false. If an archive is too large for a tab, the answer is chunked or
streaming client-side parsing.

**2. The survey completes before the respondent sees any of their own records.**

Reversing this contaminates self-report with the record and destroys the central
measurement. Route order is deliberate: consent, request, survey, review,
receipt.

**3. Sessions where the respondent declines to release are kept.**

They are not failures or garbage to clean up. Holding survey data for
non-releasers is what makes donation-selection bias directly measurable, which
almost no data-donation study can do. Never add a cleanup job that deletes them.

**4. Test fixtures are synthetic.**

Anyone working on the parsers will have their own real Takeout archive and
`conversations.json` on disk. This repo is public. The first block of
`.gitignore` covers the common paths; do not weaken it, and do not commit a real
export as a fixture.

**5. AI answers are collected; the respondent must be able to see them.**

Records from AI-mediated sources carry the answer the respondent was shown
and the sources it cited - that is the measurement a client is buying, not a
by-product. It is also the largest single thing we ask anyone to hand over, so
the review step has to render it. A 2,000-word answer behind a checkbox nobody
opened is not consent.

**6. Respondents authenticate in their own browser session.**

Export requests are ordinary links out to the vendor. Never embed a vendor login
in a WebView or in-app browser we control - that hands us their session, which
is the thing this design exists to avoid.

## Conventions

- Next.js App Router, TypeScript, Tailwind v4. Turbopack is the default in 16.
- `npm run build` before pushing. Lint with `npm run lint`.
- Comments explain why, not what. Skip them where the code already says it.
