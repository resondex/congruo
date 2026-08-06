/**
 * Creates an account. There is no self-serve signup, so this is how the first
 * staff account comes into being and how any account is made before the invite
 * flow exists.
 *
 *   npm run create-user -- --email you@resondex.com --role staff
 *   npm run create-user -- --email them@client.com --role client_admin --org acme
 *
 * The password is prompted for with the terminal echo off, so it never reaches
 * shell history, a process list, or a log.
 */

import postgres from 'postgres'
import readline from 'node:readline'
import { hashPassword } from '../.auth/password.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]])
    return pairs
  }, [])
)

const ROLES = ['staff', 'client_admin', 'client_viewer']

if (!args.email || !args.role) {
  console.error('Usage: npm run create-user -- --email <email> --role <role> [--org <slug>] [--name "Full Name"]')
  console.error(`Roles: ${ROLES.join(', ')}`)
  process.exit(1)
}
if (!ROLES.includes(args.role)) {
  console.error(`Unknown role: ${args.role}. One of ${ROLES.join(', ')}.`)
  process.exit(1)
}
if (args.role === 'staff' && args.org) {
  console.error('Staff accounts belong to no org.')
  process.exit(1)
}
if (args.role !== 'staff' && !args.org) {
  console.error('Client accounts need --org <slug>. Create one with --create-org "Name".')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local.')
  process.exit(1)
}

/** Reads a line with the terminal echo suppressed. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) return
      process.stdout.clearLine(0)
      process.stdout.cursorTo(0)
      process.stdout.write(prompt)
    }
    process.stdin.on('data', onData)
    rl.question(prompt, (answer) => {
      process.stdin.removeListener('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

try {
  const email = args.email.trim().toLowerCase()

  let orgId = null
  if (args.org) {
    const found = await sql`select id, name from orgs where slug = ${args.org}`
    if (!found.length) {
      console.error(`No org with slug "${args.org}". Create it first:`)
      console.error(`  npm run create-org -- --name "Acme Inc" --slug ${args.org}`)
      process.exit(1)
    }
    orgId = found[0].id
    console.log(`org: ${found[0].name}`)
  }

  const existing = await sql`select id from users where email = ${email}`
  if (existing.length) {
    console.error(`An account already exists for ${email}.`)
    process.exit(1)
  }

  const password = await askHidden(`Password for ${email}: `)
  if (password.length < 12) {
    console.error('Use at least 12 characters.')
    process.exit(1)
  }
  const again = await askHidden('Again: ')
  if (password !== again) {
    console.error('They do not match.')
    process.exit(1)
  }

  const { hash, salt } = await hashPassword(password)
  const [user] = await sql`
    insert into users (email, name, role, org_id, password_hash, password_salt)
    values (${email}, ${args.name ?? null}, ${args.role}, ${orgId}, ${hash}, ${salt})
    returning id, email, role
  `
  console.log(`\ncreated ${user.role}: ${user.email}`)
} finally {
  await sql.end()
}
