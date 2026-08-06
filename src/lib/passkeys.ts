import 'server-only'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { db } from './db'
import type { User } from './auth'

/**
 * Passkeys.
 *
 * Verification is done by @simplewebauthn rather than by hand. WebAuthn
 * responses are CBOR wrapping COSE keys, and the checks that matter - origin,
 * relying party hash, signature, counter - are each easy to implement in a way
 * that looks right and accepts things it should not. This is the one place in
 * the project where a dependency is clearly safer than our own code.
 *
 * What we store is a public key. Unlike a password hash, this table is not
 * worth stealing.
 */

/**
 * The relying party id: the domain a passkey is bound to.
 *
 * Wrong here and passkeys silently stop working after a deploy, because a
 * credential made for one id cannot be used for another. It has to be the
 * registrable domain - not a full URL, no port, no scheme - so localhost is
 * "localhost" and a Vercel deployment is its hostname.
 */
function relyingParty(origin: string) {
  const url = new URL(origin)
  return { id: url.hostname, origin: url.origin }
}

const CHALLENGE_MINUTES = 5

async function keepChallenge(
  challenge: string,
  kind: 'register' | 'authenticate',
  userId: string | null
) {
  await db()`
    insert into webauthn_challenges (challenge, user_id, kind, expires_at)
    values (
      ${challenge}, ${userId}, ${kind},
      ${new Date(Date.now() + CHALLENGE_MINUTES * 60_000)}
    )
  `
}

/**
 * Takes a challenge, and refuses to give the same one twice.
 *
 * Deleting as it is read is the point: a signature is only evidence if it
 * covers a value we issued and have not accepted before.
 */
async function spendChallenge(
  challenge: string,
  kind: 'register' | 'authenticate'
): Promise<{ userId: string | null } | null> {
  const rows = await db()<{ user_id: string | null }[]>`
    delete from webauthn_challenges
    where challenge = ${challenge} and kind = ${kind} and expires_at > now()
    returning user_id
  `
  return rows.length ? { userId: rows[0].user_id } : null
}

interface CredentialRow {
  id: string
  public_key: Buffer
  counter: string
  transports: string[] | null
}

export async function startRegistration(user: User, origin: string) {
  const { id: rpID } = relyingParty(origin)
  const existing = await db()<CredentialRow[]>`
    select id, public_key, counter, transports
    from webauthn_credentials where user_id = ${user.id}
  `

  const options = await generateRegistrationOptions({
    rpName: 'Congruo',
    rpID,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    // Ask the authenticator to hold the key itself, so signing in needs no
    // username - which is the entire user-experience argument for passkeys.
    attestationType: 'none',
    // Offering what they already have stops a second passkey being made on a
    // device that has one.
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: (c.transports ?? undefined) as never,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await keepChallenge(options.challenge, 'register', user.id)
  return options
}

export async function finishRegistration(
  user: User,
  origin: string,
  response: RegistrationResponseJSON,
  label: string | null
): Promise<{ ok: true } | { error: string }> {
  const { id: rpID, origin: expectedOrigin } = relyingParty(origin)

  const challenge = response.response.clientDataJSON
    ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString())
        .challenge
    : null
  if (!challenge) return { error: 'That passkey could not be read.' }

  const held = await spendChallenge(challenge, 'register')
  // Bound to the account that asked for it: a challenge issued to one person
  // must not be usable to attach a key to another.
  if (!held || held.userId !== user.id) {
    return { error: 'That registration has expired. Try again.' }
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
    })
  } catch {
    return { error: 'That passkey could not be verified.' }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { error: 'That passkey could not be verified.' }
  }

  const { credential } = verification.registrationInfo
  await db()`
    insert into webauthn_credentials (id, user_id, public_key, counter, label, transports)
    values (
      ${credential.id}, ${user.id}, ${Buffer.from(credential.publicKey)},
      ${credential.counter}, ${label}, ${response.response.transports ?? null}
    )
    on conflict (id) do nothing
  `
  return { ok: true }
}

/**
 * Options for signing in.
 *
 * No account is named and none is looked up. Passing an email here would make
 * the endpoint a way to ask which addresses have passkeys; the authenticator
 * knows which key belongs to this site and offers it without our help.
 */
export async function startAuthentication(origin: string) {
  const { id: rpID } = relyingParty(origin)
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  })
  await keepChallenge(options.challenge, 'authenticate', null)
  return options
}

export async function finishAuthentication(
  origin: string,
  response: AuthenticationResponseJSON
): Promise<{ userId: string } | { error: string }> {
  const { id: rpID, origin: expectedOrigin } = relyingParty(origin)

  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString()
  ).challenge as string | undefined
  if (!challenge) return { error: 'That sign-in could not be read.' }

  if (!(await spendChallenge(challenge, 'authenticate'))) {
    return { error: 'That sign-in attempt has expired. Try again.' }
  }

  const rows = await db()<(CredentialRow & { user_id: string; disabled_at: string | null })[]>`
    select c.id, c.public_key, c.counter, c.transports, c.user_id, u.disabled_at
    from webauthn_credentials c
    join users u on u.id = c.user_id
    where c.id = ${response.id}
    limit 1
  `
  if (!rows.length || rows[0].disabled_at) {
    return { error: 'That passkey is not recognised.' }
  }
  const stored = rows[0]

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.public_key),
        counter: Number(stored.counter),
        transports: (stored.transports ?? undefined) as never,
      },
    })
  } catch {
    return { error: 'That passkey could not be verified.' }
  }

  if (!verification.verified) return { error: 'That passkey could not be verified.' }

  // A counter that has not moved forward on an authenticator that implements
  // one means a cloned key. The library flags it; we record the new value.
  await db()`
    update webauthn_credentials
    set counter = ${verification.authenticationInfo.newCounter},
        last_used_at = now()
    where id = ${stored.id}
  `
  return { userId: stored.user_id }
}

export interface PasskeyRow {
  id: string
  label: string | null
  createdAt: string
  lastUsedAt: string | null
}

export async function passkeysFor(userId: string): Promise<PasskeyRow[]> {
  const rows = await db()<
    { id: string; label: string | null; created_at: string; last_used_at: string | null }[]
  >`
    select id, label, created_at, last_used_at
    from webauthn_credentials where user_id = ${userId}
    order by created_at
  `
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }))
}

/** Scoped to the owner: an id alone must not be enough to remove someone's key. */
export async function removePasskey(userId: string, id: string): Promise<void> {
  await db()`
    delete from webauthn_credentials where id = ${id} and user_id = ${userId}
  `
}
