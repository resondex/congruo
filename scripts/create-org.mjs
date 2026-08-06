/**
 * Creates an organisation. Client accounts belong to one, and it is the whole
 * of the access model: every query for a client is filtered by its id.
 *
 *   npm run create-org -- --name "Acme Inc" --slug acme
 */

import postgres from 'postgres'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]])
    return pairs
  }, [])
)

if (!args.name) {
  console.error('Usage: npm run create-org -- --name "Acme Inc" [--slug acme]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local.')
  process.exit(1)
}

const slug =
  args.slug ??
  args.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const sql = postgres(process.env.DATABASE_URL, { prepare: false })
try {
  const [org] = await sql`
    insert into orgs (name, slug) values (${args.name}, ${slug})
    on conflict (slug) do update set name = excluded.name
    returning id, name, slug
  `
  console.log(`org: ${org.name} (${org.slug})`)
} finally {
  await sql.end()
}
