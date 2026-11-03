import { describe, expect, it } from 'vitest'
import { migrationSql, partnerKind, planMigration, readPartners, ROW_BASE, rowLabel } from './migration'

const today = new Date('2026-11-02T12:00:00')
const closed = `lo_email,first_name,last_name,stage,email,phone,closing_date,property_address,old_site_id,SSN
connor@mps.mortgage,Jane,TEST,Closed,jane.test@example.com,2145550100,03/15/2024,123 Sample Ln,OLD-1,123-45-6789
connor@mps.mortgage,Nora,TEST,Closed,,,,,OLD-2,`
const leads = `Loan Officer Email,First Name,Last Name,Status,Email Address,Favorite Color
connor@mps.mortgage,Lee,TEST,Lead,lee.test@example.com,blue`

describe('partners', () => {
  it('reads the partner type', () => {
    expect(partnerKind('Realtor')).toBe('realtor')
    expect(partnerKind('')).toBe('realtor')
    expect(partnerKind('Title company')).toBe('title')
    expect(partnerKind('Escrow officer')).toBe('title')
    expect(partnerKind('Home builder')).toBe('builder')
    expect(partnerKind('Past client referral')).toBe('referral')
    expect(partnerKind('Insurance')).toBe('other')
  })
  it('keeps partners with an email or phone, and says why the rest are left out', () => {
    const r = readPartners('Name,Company,Email,Phone,Type\nAgent TEST,Sample Realty,Agent.Test@Example.com ,,Realtor\nBo TEST,,,(214) 555-0192,Builder\nNo Contact,,,,\n,,,,')
    expect(r.partners).toEqual([
      { row: 2, kind: 'realtor', name: 'Agent TEST', company: 'Sample Realty', email: 'agent.test@example.com', phone: null },
      { row: 3, kind: 'builder', name: 'Bo TEST', company: null, email: null, phone: '2145550192' },
    ])
    expect(r.problems).toEqual([{ row: 4, reason: expect.stringContaining('no usable email or phone') }])
  })
})

describe('planMigration', () => {
  const plan = planMigration([{ name: 'closed.csv', text: closed }, { name: 'leads.csv', text: leads }], null, today)
  it('numbers rows by file so problems point back to the right file', () => {
    expect(plan.rows.map((r) => r.row)).toEqual([ROW_BASE + 2, 2 * ROW_BASE + 2])
    expect(rowLabel(['closed.csv', 'leads.csv'], 2 * ROW_BASE + 2)).toBe('leads.csv row 2')
  })
  it('leaves out rows the import checks stop, with the reason', () => {
    expect(plan.problems).toEqual([{ file: 'closed.csv', row: 3, name: 'Nora TEST', errors: expect.arrayContaining([expect.stringContaining('closing_date')]) }])
  })
  it('lists columns it does not move, and never reads Social Security columns', () => {
    expect(plan.ignoredColumns).toEqual([{ file: 'leads.csv', columns: ['Favorite Color'] }])
    expect(plan.sensitiveColumns).toEqual([{ file: 'closed.csv', columns: ['SSN'] }])
    expect(JSON.stringify(plan.rows)).not.toContain('6789')
  })
  it('stops when a file is missing a required column', () => {
    expect(() => planMigration([{ name: 'bad.csv', text: 'first_name,last_name\nJane,TEST' }], null, today)).toThrow(/bad.csv is missing required columns: lo_email, stage/)
  })
})

describe('migrationSql', () => {
  const plan = planMigration([{ name: 'closed.csv', text: closed }], 'Name,Email\nAgent TEST,agent.test@example.com', today)
  const opts = { runAsEmail: 'connor@mps.mortgage', files: ['closed.csv'], builtAt: '11/2/26' }
  it('a preview passes save = false and says so', () => {
    const sql = migrationSql(plan, { ...opts, save: false })
    expect(sql).toContain('v_save  boolean := false')
    expect(sql).toContain('preview finished (nothing saved)')
  })
  it('the real run ends with the confirmation row', () => {
    const sql = migrationSql(plan, { ...opts, save: true })
    expect(sql).toContain('v_save  boolean := true')
    expect(sql.trimEnd()).toMatch(/'LOSuite old app migration finished' as result[\s\S]*from losuite_migration_results;$/)
    expect(sql).toContain('"old_site_id":"OLD-1"')
    expect(sql).toContain('"email":"agent.test@example.com"')
  })
  it("escapes the owner's email and refuses data that would break the quoting", () => {
    expect(migrationSql(plan, { ...opts, runAsEmail: "o'neil@mps.mortgage", save: true })).toContain("lower('o''neil@mps.mortgage')")
    const sneaky = planMigration([{ name: 'x.csv', text: 'lo_email,first_name,last_name,stage,email\nconnor@mps.mortgage,A,$losuite_migration$,Lead,a@example.com' }], null, today)
    expect(() => migrationSql(sneaky, { ...opts, save: true })).toThrow(/quote marker/)
  })
})
