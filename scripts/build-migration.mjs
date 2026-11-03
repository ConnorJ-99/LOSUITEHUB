// Builds the old-app migration scripts from CSV files (src/lib/import/migration.ts).
// Usage:
//   node scripts/build-migration.mjs --owner connor@mps.mortgage [--partners partners.csv] clients1.csv [clients2.csv ...]
// Client files use the Contacts → Import CSV columns (ARIVE's pipeline export works as it comes).
// Output, in supabase/.paste/ (git-ignored; it holds client data, never commit it):
//   old-app-migration-PREVIEW.sql   run first: reports what would happen, saves nothing
//   old-app-migration.sql           the real move
//   old-app-migration-report.txt    rows left out, columns not read
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { runnerImport } from 'vite'

const args = process.argv.slice(2)
const take = (flag) => {
  const i = args.indexOf(flag)
  if (i < 0) return null
  const [, value] = args.splice(i, 2)
  return value
}
const owner = take('--owner')
const partnersPath = take('--partners')
if (!owner || (args.length === 0 && !partnersPath)) {
  console.error('Usage: node scripts/build-migration.mjs --owner connor@mps.mortgage [--partners partners.csv] clients.csv ...')
  process.exit(1)
}

const { module: m } = await runnerImport('/src/lib/import/migration.ts')
const files = args.map((p) => ({ name: basename(p), text: readFileSync(p, 'utf8') }))
const plan = m.planMigration(files, partnersPath ? readFileSync(partnersPath, 'utf8') : null)
const names = files.map((f) => f.name)
const builtAt = `${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'short', timeStyle: 'short' })} Central`

mkdirSync('supabase/.paste', { recursive: true })
writeFileSync('supabase/.paste/old-app-migration-PREVIEW.sql', m.migrationSql(plan, { runAsEmail: owner, save: false, files: names, builtAt }))
writeFileSync('supabase/.paste/old-app-migration.sql', m.migrationSql(plan, { runAsEmail: owner, save: true, files: names, builtAt }))

const lines = [
  `Built ${builtAt}: ${plan.rows.length} client rows ready, ${plan.problems.length} left out; ${plan.partners.length} partners ready, ${plan.partnerProblems.length} left out.`,
  '',
  ...plan.sensitiveColumns.map((s) => `${s.file}: never read (Social Security / tax ID): ${s.columns.join(', ')}`),
  ...plan.ignoredColumns.map((s) => `${s.file}: columns not moved: ${s.columns.join(', ')}`),
  '',
  ...plan.problems.map((p) => `${p.file} row ${p.row} (${p.name}): ${p.errors.join(' ')}`),
  ...plan.partnerProblems.map((p) => `partners row ${p.row}: ${p.reason}`),
]
writeFileSync('supabase/.paste/old-app-migration-report.txt', lines.join('\n') + '\n')
console.log(lines.join('\n'))
console.log('\nWrote supabase/.paste/old-app-migration-PREVIEW.sql, old-app-migration.sql and old-app-migration-report.txt')
