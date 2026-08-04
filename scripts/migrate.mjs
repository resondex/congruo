/**
 * Applies supabase/migrations/*.sql in filename order.
 *
 * Run with:  npm run migrate
 *
 * Every migration is written to be idempotent (`if not exists`, `on conflict
 * do nothing`), so re-running is safe and is the normal way to bring a fresh
 * database up to date.
 *
 * Connects through the transaction pooler, which hands the connection to
 * another client between statements - hence `prepare: false`, and the simple
 * query protocol so a file of several statements applies as one unit.
 */

import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env.local.')
  process.exit(1)
}

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

if (!files.length) {
  console.error(`No .sql files found in ${dir}`)
  process.exit(1)
}

const sql = postgres(url, { prepare: false, onnotice: () => {} })

let failed = false
for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8')
  try {
    await sql.unsafe(text).simple()
    console.log(`  applied  ${file}`)
  } catch (error) {
    failed = true
    console.error(`  FAILED   ${file}`)
    console.error(`           ${error.message}`)
    break
  }
}

if (!failed) {
  const [{ tables }] = await sql`
    select count(*)::int as tables
    from information_schema.tables
    where table_schema = 'public'
  `
  const [{ grants }] = await sql`
    select count(*)::int as grants
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'service_role'
  `
  const studies = await sql`select slug, mode from studies order by slug`

  console.log('')
  console.log(`  tables in public:      ${tables}`)
  console.log(`  service_role grants:   ${grants}`)
  console.log(
    `  studies seeded:        ${studies.map((s) => `${s.slug} (${s.mode})`).join(', ') || 'none'}`
  )
}

await sql.end()
process.exit(failed ? 1 : 0)
