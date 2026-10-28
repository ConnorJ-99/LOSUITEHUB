import { describe, expect, it } from 'vitest'
import { findEffectiveDate, findVersion, guessDocument, matchPrograms, productName, titleFromFile } from './docGuess'

const page = (...lines: string[]) => lines
/** A matrix page: rows of credit bands and percents. */
const grid = page('Max CLTV by credit score', ...Array.from({ length: 8 }, (_, i) => `${760 - i * 20}+ 90% 85% 80% 75% 70%`))
const prose = page('Section 4.2 Bank statement income', 'Qualifying income is total eligible deposits less a 50% expense factor or the actual expense ratio from a CPA letter.', 'Transfers between accounts and large unexplained deposits are excluded from qualifying income.')

/** Sample programs like the dev catalog's (fictional). */
const PROGRAMS = [
  { id: 'conv', name: 'Conventional', family: 'conventional' as const, lien: 'first' as const, docTypes: ['full_doc' as const], features: [] },
  { id: 'hr', name: 'Conventional HomeReady', family: 'conventional' as const, lien: 'first' as const, docTypes: ['full_doc' as const], features: ['homeready_possible' as const] },
  { id: 'fha', name: 'FHA', family: 'fha' as const, lien: 'first' as const, docTypes: ['full_doc' as const], features: [] },
  { id: 'fhadpa', name: 'FHA with Down Payment Assistance', family: 'fha' as const, lien: 'first' as const, docTypes: ['full_doc' as const], features: ['dpa' as const] },
  { id: 'dscr', name: 'DSCR', family: 'non_qm' as const, lien: 'first' as const, docTypes: ['dscr' as const], features: [] },
  { id: 'dscrces', name: 'DSCR Closed-End Second', family: 'non_qm' as const, lien: 'ces' as const, docTypes: ['dscr' as const], features: [] },
  { id: 'bs', name: 'Bank Statement', family: 'non_qm' as const, lien: 'first' as const, docTypes: ['bank_statement_12' as const], features: [] },
]

describe('reading the file name', () => {
  it('cleans the title and finds the version', () => {
    expect(titleFromFile('Equity_Advantage-HELOC Jul 2026 1.3.pdf')).toBe('Equity Advantage HELOC Jul 2026 1.3')
    expect(findVersion('Equity Advantage HELOC Jul 2026 1.3')).toBe('Jul 2026 1.3')
    expect(findVersion('DSCR Guidelines v4.2')).toBe('v4.2')
    expect(findVersion('Bank Statement Guide rev. 09/2026')).toBe('rev. 09/2026')
    expect(findVersion('Non-QM Matrix October 2026')).toBe('Oct 2026')
    expect(findVersion('Conventional Guide')).toBeNull()
  })
  it('finds the effective date in the ways lenders print it', () => {
    expect(findEffectiveDate('Effective Date: 10/01/2026')).toBe('2026-10-01')
    expect(findEffectiveDate('effective as of October 1, 2026 for all locks')).toBe('2026-10-01')
    expect(findEffectiveDate('Effective 2026-07-15')).toBe('2026-07-15')
    expect(findEffectiveDate('Effective immediately')).toBeNull()
  })
  it('keeps only the product in a program name', () => {
    expect(productName('Equity Advantage HELOC Jul 2026 1.3')).toBe('Equity Advantage HELOC')
    expect(productName('Keystone DSCR Guidelines v4.2')).toBe('Keystone DSCR')
    expect(productName('Bank Statement Second Lien Matrix rev. 09/2026')).toBe('Bank Statement Second Lien')
  })
})

describe('guessing a document', () => {
  it("reads Connor's HELOC guide as a HELOC with its version", () => {
    const g = guessDocument({ fileName: 'Equity Advantage HELOC Jul 2026 1.3.pdf', pages: [prose, prose, prose] })
    expect(g).toMatchObject({ docType: 'guidelines', title: 'Equity Advantage HELOC Jul 2026 1.3', versionLabel: 'Jul 2026 1.3' })
    expect(g.product).toMatchObject({ name: 'Equity Advantage HELOC', lien: 'heloc', family: 'non_qm', termOptions: ['heloc_10_20'], basis: 'title' })
  })
  it('reads a HELOC draw and repay period from the text', () => {
    const g = guessDocument({ fileName: 'Prime HELOC.pdf', pages: [page('10-year draw period followed by a 15-year repayment period')] })
    expect(g.product.termOptions).toEqual(['heloc_10_15'])
  })
  it('a grid of percents is a matrix, even without "matrix" in the name', () => {
    expect(guessDocument({ fileName: 'Keystone Oct 2026.pdf', pages: [grid, grid] }).docType).toBe('matrix')
    expect(guessDocument({ fileName: 'Keystone Non-QM Matrix.pdf', pages: [prose] }).docType).toBe('matrix')
    expect(guessDocument({ fileName: 'Summit HELOC Oct 2026.pdf', pages: [page('Summit HELOC - Eligibility Matrix', ...prose)] }).docType).toBe('matrix')
    expect(guessDocument({ fileName: 'Summit HELOC Oct 2026.pdf', pages: [page(...prose, 'See the program matrix for limits.')] }).docType).toBe('guidelines')
  })
  it('names bulletins and rate sheets', () => {
    expect(guessDocument({ fileName: 'Overlay Bulletin 2026-14.pdf', pages: [prose] }).docType).toBe('overlay_bulletin')
    expect(guessDocument({ fileName: 'Daily Rate Sheet.pdf', pages: [grid] }).docType).toBe('rate_sheet')
  })
  it('reads non-QM products, liens and doc types from the name', () => {
    expect(guessDocument({ fileName: 'Bank Statement Second Lien Matrix.pdf', pages: [grid] }).product).toMatchObject({ family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'] })
    expect(guessDocument({ fileName: 'DSCR Closed-End Second v2.pdf', pages: [] }).product).toMatchObject({ family: 'non_qm', lien: 'ces', docTypes: ['dscr'] })
    expect(guessDocument({ fileName: 'ITIN Full Doc.pdf', pages: [] }).product).toMatchObject({ family: 'non_qm', features: ['itin'] })
    expect(guessDocument({ fileName: 'FHA Guide.pdf', pages: [] }).product).toMatchObject({ family: 'fha', lien: 'first', docTypes: ['full_doc'] })
  })
  it('falls back to the first pages when the name says nothing', () => {
    const g = guessDocument({ fileName: 'doc_8812.pdf', pages: [page('Debt Service Coverage Ratio (DSCR) program for investors', '30 year and 40 year fixed, 7/6 ARM')] })
    expect(g.product).toMatchObject({ family: 'non_qm', docTypes: ['dscr'], basis: 'text', termOptions: ['fixed_40', 'fixed_30', 'arm_7_6'] })
  })
  it('with nothing to go on, guesses conventional and says so', () => {
    expect(guessDocument({ fileName: 'scan.pdf', pages: [] }).product).toMatchObject({ family: 'conventional', lien: 'first', basis: 'none', termOptions: ['fixed_30'] })
  })
})

describe('matching programs', () => {
  const g = (fileName: string) => guessDocument({ fileName, pages: [] }).product
  it('a conventional guide covers the conventional programs, not FHA', () => {
    expect(matchPrograms(g('Northstar Conventional Guide.pdf'), PROGRAMS)).toEqual(['conv', 'hr'])
  })
  it('a name or feature narrows it to the program it is about', () => {
    expect(matchPrograms(g('HomeReady Matrix.pdf'), PROGRAMS)).toEqual(['hr'])
    expect(matchPrograms(g('FHA DPA Matrix.pdf'), PROGRAMS)).toEqual(['fhadpa'])
  })
  it('keeps 1st liens and seconds apart', () => {
    expect(matchPrograms(g('DSCR Matrix.pdf'), PROGRAMS)).toEqual(['dscr'])
    expect(matchPrograms(g('DSCR Closed-End Second Matrix.pdf'), PROGRAMS)).toEqual(['dscrces'])
  })
  it('finds nothing for a HELOC when the lender has no HELOC program', () => {
    expect(matchPrograms(g('Equity Advantage HELOC Jul 2026 1.3.pdf'), PROGRAMS)).toEqual([])
  })
})
