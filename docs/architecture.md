# Architecture notes

Decisions and the reasoning behind them. Update this when a decision changes, and
say why rather than only what.

## Why the sequence is ordered this way

The survey must complete before the respondent sees any of their own records. If
the order reverses, self-report is contaminated by the record and the central
measurement is destroyed. Every other design choice is subordinate to this.

A secondary consequence is worth protecting: because the survey completes first,
we hold complete survey data on respondents who then decline to release. That
makes donation-selection bias directly measurable. Most data-donation studies
cannot do this and have to argue their way around it. Do not restructure the flow
in a way that loses it.

## Why append mode sends the respondent to us twice

In full service the export builds while our survey runs. In append mode the
interview is on someone else's platform, so a single hop would land the
respondent on our review screen with nothing to do for the minutes or hours the
archive takes. That is the highest-drop-off configuration available.

Two hops fix it: consent and request at the top of their survey, review and
release at the end. Their interview fills the wait instead of ours. Every
enterprise survey platform can redirect from an arbitrary page, so this is
scripting on their side rather than a platform limitation.

Single-hop remains supported for clients who can only wire one redirect. Expect a
materially worse release rate and quote it accordingly.

### The status codes are load-bearing

`declined` and `error` must never be collapsed. In full service we can measure
donation-selection bias ourselves, because we hold survey data for people who do
not release. In append mode the client holds that data, so the only way they can
run the same check is if we tell them which respondents declined. Merging the two
statuses removes a headline property of the product and nothing would fail
visibly.

## Why we connect to Postgres directly rather than through the Data API

Supabase's Data API exists so browsers can query the database with RLS scoping
what they see. This app has no browser client, no auth, no realtime and no RLS
policies: every read and write is a server-side query from a route handler.

Carrying PostgREST anyway cost us a layer of configuration we got nothing from -
exposed schemas, schema-cache reloads, and grants to API roles - and every fix
for those makes the database *more* reachable, which is backwards for a store of
people's search history. Connecting directly lets the Data API stay switched off.

RLS stays enabled with no policies as a backstop, and `0003_grants.sql` grants
only `service_role` while explicitly revoking `anon` and `authenticated`. Those
are now belt and braces rather than the actual control, which is that nothing
outside a route handler holds a credential.

## Client-side parsing is a consent property, not a performance choice

The raw archive must never reach the server. See the README for the practical
rules. The failure mode to guard against is an innocuous-looking "just upload it
and we'll parse it server-side, it's easier" refactor, which silently voids the
claim the whole product rests on.

If a payload is ever too large to parse in a tab, the answer is streaming or
chunked client-side parsing, not a server upload.

## Why assisted export rather than automated pulls

Only Google offers a supported third-party API for a user's own activity data,
and it is unavailable in the US. There is no OAuth scope anywhere for reading a
consumer ChatGPT, Claude, or Perplexity account's conversation history; the public
OpenAI API returns only completions from your own API calls.

The automated alternatives all involve driving the respondent's authenticated web
session. That is a terms-of-service problem, it breaks whenever a frontend ships,
and it is the mechanism behind the browser-extension data-harvesting scandals.
Ruled out.

### Rejected: forwarding the export email

Asking respondents to forward the export email would remove the file-handling step
and is therefore tempting. It is not an option. The download link is
bearer-authenticated, so we would receive the raw unredacted archive and the
respondent would never see what they sent. It deletes the review gate.

## Why the meter is out of scope

An earlier design centered on a continuous passive meter: a native app with a
local VPN for domain-level traffic and OS usage APIs for app sessions. It was cut.

A meter requires an installed app, app store review, elevated device permissions,
and continuous panel maintenance, and it carries a heavy support burden. A
request-survey-release session needs none of that and runs in mobile web. The
meter remains a possible add-on for engagements that specifically require
continuous behavior, but it is not part of a standard fielding.

## Why iOS gets no special-case backend

The flow is deliberately built from primitives that work on iOS Safari:

- `SFSafariViewController`-equivalent behavior via ordinary links, so the
  respondent authenticates in their own browser session and the app never holds
  their credentials. An in-app `WKWebView` login would hand us their session and
  is not acceptable.
- `<input type="file">`, which on iOS reads from Files and iCloud Drive
- Standard web push and email for re-engagement

## Open question

**Release rate under re-engagement**, when the archive is not ready before the
survey ends. The entire model rests on it and it cannot be estimated from outside.
Measuring it is the purpose of the first study.

Mitigations already in the design: fire the request before anything else, fill the
wait with the survey, pay separately for completion and for release, and keep the
session resumable across days.
