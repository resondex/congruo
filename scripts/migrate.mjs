/**
 * Applies supabase/migrations/*.sql in filename order, once each.
 *
 * Run with:  npm run migrate
 *
 * Applied files are recorded, and this is not a refinement - it is a
 * correctness requirement that was learned the hard way. The runner used to
 * replay every file on every run, on the theory that they were all idempotent.
 * That holds for `if not exists`, and does not hold for anything that REPLACES
 * state: an early migration that set a check constraint replayed happily until
 * a later one widened it and rows appeared that the old, narrower version
 * rejected. Replaying then failed against data that was perfectly valid.
 *
 * In order, on a fresh database, every file still applies cleanly. What is not
 * safe is applying an old file to a database that has moved past it, which is
 * exactly what replaying does.
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

await sql`
  create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  )
`

const [{ tracked }] = await sql`select count(*)::int as tracked from schema_migrations`
const [{ existing }] = await sql`
  select count(*)::int as existing from information_schema.tables
  where table_schema = 'public' and table_name = 'studies'
`

// A database that already has the schema but no record of it predates this
// tracking. Everything on disk is by definition already applied to it, so
// record that rather than replaying and failing.
if (tracked === 0 && existing > 0) {
  await sql`
    insert into schema_migrations ${sql(files.map((filename) => ({ filename })))}
    on conflict (filename) do nothing
  `
  console.log(`  adopted  ${files.length} existing migrations`)
}

const done = new Set(
  (await sql`select filename from schema_migrations`).map((r) => r.filename)
)

let failed = false
let applied = 0
for (const file of files) {
  if (done.has(file)) continue
  const text = fs.readFileSync(path.join(dir, file), 'utf8')
  try {
    await sql.unsafe(text).simple()
    await sql`insert into schema_migrations (filename) values (${file})`
    console.log(`  applied  ${file}`)
    applied++
  } catch (error) {
    failed = true
    console.error(`  FAILED   ${file}`)
    console.error(`           ${error.message}`)
    break
  }
}

if (!failed && applied === 0) console.log('  nothing new to apply')

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
