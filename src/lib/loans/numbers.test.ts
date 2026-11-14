import { describe, expect, it } from 'vitest'
import { cleanNumber, matchesLoanNumber, missingForStage, needsLenderNumber, resolveLender, type LoanNumbers } from './numbers'

const lenders = [
  { id: 'a', name: 'UWM' },
  { id: 'b', name: 'Newfi' },
]
const base: LoanNumbers = { ready: true, programLenderId: null, lenderId: null, lenderNameTyped: null, lenderLoanNumber: null, ariveLoanNumber: null, titleFileNumber: null, mortgageeClauseOverride: null }

describe('resolveLender', () => {
  it("prefers the program's lender, then the picked one, then the typed name", () => {
    expect(resolveLender({ ...base, programLenderId: 'a', lenderId: 'b' }, lenders)).toEqual({ id: 'a', name: 'UWM', from: 'program' })
    expect(resolveLender({ ...base, lenderId: 'b', lenderNameTyped: 'Old' }, lenders)).toEqual({ id: 'b', name: 'Newfi', from: 'file' })
    expect(resolveLender({ ...base, lenderNameTyped: ' Old Bank ' }, lenders)).toEqual({ id: null, name: 'Old Bank', from: 'typed' })
    expect(resolveLender(base, lenders)).toEqual({ id: null, name: null, from: null })
  })
})

describe('missingForStage', () => {
  it('asks for the lender and loan number from Processing on', () => {
    const none = resolveLender(base, lenders)
    expect(needsLenderNumber('under_contract')).toBe(false)
    expect(missingForStage(base, none, 'under_contract')).toEqual([])
    expect(missingForStage(base, none, 'processing')).toEqual(['lender', 'lender_loan_number'])
    const n = { ...base, lenderId: 'a', lenderLoanNumber: '  ' }
    expect(missingForStage(n, resolveLender(n, lenders), 'closed')).toEqual(['lender_loan_number'])
    const done = { ...n, lenderLoanNumber: '123' }
    expect(missingForStage(done, resolveLender(done, lenders), 'clear_to_close')).toEqual([])
  })
  it('requires nothing before the script has run', () => {
    expect(missingForStage({ ...base, ready: false }, resolveLender(base, lenders), 'processing')).toEqual([])
  })
})

describe('loan numbers', () => {
  it('cleans and matches ignoring dashes, spaces and case', () => {
    expect(cleanNumber('  GF  26-11873 ')).toBe('GF 26-11873')
    expect(cleanNumber('   ')).toBeNull()
    expect(matchesLoanNumber('2611873', ['GF 26-11873'])).toBe(true)
    expect(matchesLoanNumber('gf26', [null, 'GF 26-11873'])).toBe(true)
    expect(matchesLoanNumber('26', ['GF 26-11873'])).toBe(false)
    expect(matchesLoanNumber('999', ['GF 26-11873', null])).toBe(false)
  })
})
