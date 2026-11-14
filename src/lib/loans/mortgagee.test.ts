import { describe, expect, it } from 'vitest'
import { clauseCsv, matchClauseRows, mortgageeClause, parseClauseCsv, type LenderClause } from './mortgagee'

const uwm: LenderClause = {
  lenderId: 'a',
  lenderName: 'UWM',
  clauseName: 'United Wholesale Mortgage, LLC ISAOA/ATIMA',
  addressLine1: 'PO Box 202028',
  addressLine2: null,
  city: 'Florence',
  state: 'SC',
  zip: '29502',
  insuranceEmail: 'insurance@uwm.com',
  insuranceFax: null,
  notes: null,
  legacy: 'old text',
}

describe('mortgageeClause', () => {
  it("uses the lender's clause plus the lender loan #", () => {
    expect(mortgageeClause(null, uwm, '123-456')).toEqual({ text: 'United Wholesale Mortgage, LLC ISAOA/ATIMA\nPO Box 202028\nFlorence, SC 29502\nLoan # 123-456', from: 'lender' })
  })
  it('the loan override wins and keeps the loan # once', () => {
    expect(mortgageeClause('Custom ISAOA\nLoan # 123-456', uwm, '123-456')).toEqual({ text: 'Custom ISAOA\nLoan # 123-456', from: 'override' })
    expect(mortgageeClause('Custom ISAOA', uwm, null)).toEqual({ text: 'Custom ISAOA', from: 'override' })
  })
  it('falls back to the old one-line clause, then nothing', () => {
    const blank = { ...uwm, clauseName: null, addressLine1: null, city: null, state: null, zip: null }
    expect(mortgageeClause(null, blank, '9')).toEqual({ text: 'old text\nLoan # 9', from: 'legacy' })
    expect(mortgageeClause(null, { ...blank, legacy: null }, '9')).toEqual({ text: null, from: null })
    expect(mortgageeClause(null, null, null)).toEqual({ text: null, from: null })
  })
})

describe('clause CSV', () => {
  it('reads rows, matches lenders by name and lists the unmatched', () => {
    const csv = 'Lender Name,clause_name,address_line1,city,state,zip,email\n"United Wholesale Mortgage",UWM ISAOA,PO Box 1,Pontiac,mi,48340,INS@UWM.COM\nNobody Bank,X,,,,,\n,missing,,,,,\nNewfi,,,,Texas,,'
    const { rows, problems } = parseClauseCsv(csv)
    expect(rows.map((r) => r.lenderName)).toEqual(['United Wholesale Mortgage', 'Nobody Bank', 'Newfi'])
    expect(rows[0]).toMatchObject({ state: 'MI', email: 'ins@uwm.com', addressLine2: null })
    expect(problems).toEqual(['Row 4: no lender name.', 'Row 5: state "TEXAS" isn\'t two letters; left blank.'])
    const m = matchClauseRows(rows, [
      { id: 'a', name: 'United Wholesale Mortgage, LLC', shortName: 'United Wholesale Mortgage' },
      { id: 'b', name: 'NEWFI' },
    ])
    expect(m.matched.map((x) => x.lenderId)).toEqual(['a', 'b'])
    expect(m.unmatched.map((x) => x.lenderName)).toEqual(['Nobody Bank'])
  })
  it('needs a lender_name column', () => {
    expect(parseClauseCsv('name,city\nA,B').problems).toEqual(['The first row needs a lender_name column.'])
  })
  it('exports the same columns', () => {
    expect(clauseCsv([uwm]).split(/\r?\n/)[0]).toBe('lender_name,clause_name,address_line1,address_line2,city,state,zip,email,notes')
  })
})
