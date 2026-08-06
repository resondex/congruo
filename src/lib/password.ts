import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Password hashing, kept free of any Next.js import.
 *
 * Split out so the account-creation script can use the same code as the app.
 * A second implementation of a KDF is a thing that drifts, and the way you
 * find out is that nobody can sign in.
 *
 * scrypt from node:crypto rather than a dependency: memory-hard, ships with
 * the runtime, and the alternative was adding a native module to a project
 * whose security story is mostly that it has very little surface.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

const KEY_LENGTH = 64

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)).toString('hex')
  return { hash, salt }
}

/**
 * Constant-time, and it does the full derivation even when the account has no
 * password set. Returning early on a missing hash would make "this account
 * exists but was never set up" measurably faster than a wrong password.
 */
export async function verifyPassword(
  password: string,
  hash: string | null,
  salt: string | null
): Promise<boolean> {
  const useHash = hash ?? randomBytes(KEY_LENGTH).toString('hex')
  const useSalt = salt ?? randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, useSalt, KEY_LENGTH)
  const expected = Buffer.from(useHash, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(derived, expected) && hash !== null
}
