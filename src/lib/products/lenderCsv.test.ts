import { describe, expect, it } from 'vitest'
import { mergedNotes, parseLenderCsv, planLenderImport, statusFrom, type ExistingLender } from './lenderCsv'

const HEADER = 'lender_name,status,lender_nmls,website,portal_url,broker_id,portal_username,ae_name,ae_phone,ae_email,ae_covers,ae2_name,ae2_phone,ae2_email,ae2_covers,scenario_desk_email,scenario_desk_phone,closing_email,condition_upload_email,clause_name,clause_address_line1,clause_address_line2,clause_city,clause_state,clause_zip,insurance_email,insurance_fax,clause_notes,notes'
const FILE = [
  HEADER,
  'Carrington,approved,2600,https://www.carringtonwholesale.com,https://brokeriq.carringtonwholesale.com/login/login.php,,,Marty Hill,(469) 863-5177,marty.hill@carringtonms.com,,,,,,,,,,Carrington Mortgage Services LLC ISAOA/ATIMA,P.O. Box 692408,,San Antonio,TX,78269-2408,,,Mortgagee/loss payee clause from Carrington wholesale site.,',
  'LoanStream,approved,,https://loanstreamwholesale.com,https://www.lsmlounge.com/,,,Andrew Chan,(817) 657-6661,achan@lsmortgage.com,,,,,,Scenarios@LSMortgage.com,(800) 760-1833,CD@LSMortgage.com,,"OCMBC, INC. ISAOA","19000 MacArthur Blvd, Suite 200",,Irvine,CA,92612,,,From Sep 2026 rate sheet.,"Portal = The Lounge. NMLS not confirmed."',
  'Northstar Wholesale (Sample),approved,,,https://example.com,,,Sample AE,(214) 555-0142,ae@example.com,,,,,,,,,,,,,,,,,,,',
  'Cake Mortgage,approved,,caketpo.com,,,,,,,,Jo Smith,,jo@cake.com,TX and OK,,,,,,,,,,,,,,',
].join('\n')

const lender = (over: Partial<ExistingLender>): ExistingLender => ({ id: 'l1', name: 'Carrington', notes: null, values: {}, contacts: [], ...over })

describe('statusFrom', () => {
  it('reads the value or the label', () => {
    expect(statusFrom('approved')).toBe('approved')
    expect(statusFrom('Application pending')).toBe('pending')
    expect(statusFrom('not signed up')).toBe('not_signed_up')
    expect(statusFrom('maybe')).toBeNull()
  })
})

describe('parseLenderCsv', () => {
  const { rows, problems } = parseLenderCsv(FILE)
  it('skips samples and says so', () => {
    expect(rows.map((r) => r.name)).toEqual(['Carrington', 'LoanStream', 'Cake Mortgage'])
    expect(problems).toEqual(['Row 4: Northstar Wholesale (Sample) is a sample, skipped.'])
  })
  it('reads the lender fields, blanks left out', () => {
    expect(rows[0].fields).toEqual({
      status: 'approved',
      nmls: '2600',
      website: 'https://www.carringtonwholesale.com',
      portal_url: 'https://brokeriq.carringtonwholesale.com/login/login.php',
      ae_name: 'Marty Hill',
      ae_phone: '(469) 863-5177',
      ae_email: 'marty.hill@carringtonms.com',
      clause_name: 'Carrington Mortgage Services LLC ISAOA/ATIMA',
      clause_address_line1: 'P.O. Box 692408',
      clause_city: 'San Antonio',
      clause_state: 'TX',
      clause_zip: '78269-2408',
      clause_notes: 'Mortgagee/loss payee clause from Carrington wholesale site.',
    })
    expect(rows[0].contacts).toEqual([])
    expect(rows[0].notes).toBeNull()
  })
  it('turns the desks and second AE into contacts', () => {
    expect(rows[1].contacts).toEqual([
      { name: 'Scenario desk', role: 'Scenario desk', phone: '(800) 760-1833', email: 'scenarios@lsmortgage.com', notes: null },
      { name: 'Closing', role: 'Closing', phone: null, email: 'cd@lsmortgage.com', notes: null },
    ])
    expect(rows[2].contacts).toEqual([{ name: 'Jo Smith', role: 'Account executive', phone: null, email: 'jo@cake.com', notes: 'Covers: TX and OK' }])
    expect(rows[2].fields.website).toBe('https://caketpo.com')
  })
  it('needs a lender_name column', () => {
    expect(parseLenderCsv('name,status\nA,approved').problems).toEqual(['The first row needs a lender_name column.'])
  })
})

describe('planLenderImport', () => {
  const { rows } = parseLenderCsv(FILE)
  it('lists only what changes, and adds the rest', () => {
    const plan = planLenderImport(rows, [
      lender({ values: { status: 'approved', nmls: '2600', ae_name: 'Marty Hill' } }),
      lender({ id: 'l2', name: 'Loan Stream', notes: 'Good on DSCR.', contacts: [{ id: 'c1', name: 'Scenario desk', role: 'scenario desk', phone: null, email: 'old@lsm.com', notes: null }] }),
    ])
    expect(plan.adds.map((r) => r.name)).toEqual(['Cake Mortgage'])
    const carrington = plan.updates[0]
    expect(carrington.changes.status).toBeUndefined()
    expect(carrington.changes.nmls).toBeUndefined()
    expect(carrington.changes.website).toBe('https://www.carringtonwholesale.com')
    expect(carrington.summary).toContain('clause')
    const ls = plan.updates[1]
    expect(ls.lenderName).toBe('Loan Stream')
    expect(ls.notes).toBe('Good on DSCR.\n\nPortal = The Lounge. NMLS not confirmed.')
    expect(ls.contacts).toEqual([
      { id: 'c1', name: 'Scenario desk', role: 'scenario desk', phone: '(800) 760-1833', email: 'scenarios@lsmortgage.com', notes: null },
      { id: null, name: 'Closing', role: 'Closing', phone: null, email: 'cd@lsmortgage.com', notes: null },
    ])
  })
  it('a second run changes nothing', () => {
    const r = rows[2]
    const plan = planLenderImport([r], [lender({ name: 'Cake Mortgage', values: { status: 'approved', website: 'https://caketpo.com' }, contacts: [{ id: 'c9', name: 'Jo Smith', role: 'Account executive', phone: null, email: 'jo@cake.com', notes: 'Covers: TX and OK' }] })])
    expect(plan.updates).toEqual([])
    expect(plan.unchanged.map((u) => u.lenderName)).toEqual(['Cake Mortgage'])
  })
})

describe('mergedNotes', () => {
  it('adds below, never twice', () => {
    expect(mergedNotes(null, 'New')).toBe('New')
    expect(mergedNotes('Old', 'New')).toBe('Old\n\nNew')
    expect(mergedNotes('Old\n\nNew', 'New')).toBeNull()
    expect(mergedNotes('Old', null)).toBeNull()
  })
})
