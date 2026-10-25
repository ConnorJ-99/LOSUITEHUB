import { describe, expect, it } from 'vitest'
import { el, escapeXml, leaf, mismoOrder, serialize } from './xml'

describe('xml writer', () => {
  it('escapes special characters', () => {
    expect(escapeXml(`Smith & Sons <"Bob's">`)).toBe('Smith &amp; Sons &lt;&quot;Bob&apos;s&quot;&gt;')
  })

  it('leaves out empty values and empty containers', () => {
    const xml = serialize(el('ROOT', [el('A', [leaf('Name', 'x'), leaf('Empty', null), leaf('Blank', '')]), el('B', [leaf('Nothing', undefined)])]))
    expect(xml).toContain('<Name>x</Name>')
    expect(xml).not.toContain('Empty')
    expect(xml).not.toContain('Blank')
    expect(xml).not.toContain('<B')
  })

  it('formats numbers and booleans the MISMO way', () => {
    const xml = serialize(el('R', [leaf('Amount', 350000), leaf('Rate', 6.5), leaf('Pmt', 2212.24), leaf('Flag', false), leaf('Zero', 0)]))
    expect(xml).toContain('<Amount>350000</Amount>')
    expect(xml).toContain('<Rate>6.5</Rate>')
    expect(xml).toContain('<Pmt>2212.24</Pmt>')
    expect(xml).toContain('<Flag>false</Flag>')
    expect(xml).toContain('<Zero>0</Zero>')
  })

  it('orders children alphabetically ignoring case, EXTENSION included, repeats kept in order', () => {
    const xml = serialize(
      el('EMPLOYMENT', [
        leaf('OwnershipInterestType', 'LessThan25Percent'),
        el('EXTENSION', [leaf('X', 1)]),
        leaf('EmploymentYearsOnJobCount', 3),
        leaf('EmploymentBorrowerSelfEmployedIndicator', true),
      ]),
    )
    const order = [...xml.matchAll(/<([A-Za-z_]+)[ >]/g)].map((m) => m[1]).slice(1)
    expect(order).toEqual(['EmploymentBorrowerSelfEmployedIndicator', 'EmploymentYearsOnJobCount', 'EXTENSION', 'X', 'OwnershipInterestType'])
    const repeats = serialize(el('ASSETS', [el('ASSET', [leaf('V', 2)], { SequenceNumber: 2 }), el('ASSET', [leaf('V', 1)], { SequenceNumber: 1 })]))
    expect(repeats.indexOf('SequenceNumber="2"')).toBeLessThan(repeats.indexOf('SequenceNumber="1"'))
  })

  it('sorts underscores before letters, as the MISMO schema does', () => {
    expect(['DOCUMENTATIONS', 'DOCUMENT_SPECIFIC_DATA_SETS'].sort(mismoOrder)).toEqual(['DOCUMENT_SPECIFIC_DATA_SETS', 'DOCUMENTATIONS'])
    expect(['LOANS', 'LOAN_DETAIL'].sort(mismoOrder)).toEqual(['LOAN_DETAIL', 'LOANS'])
  })

  it('renders attributes and skips empty ones', () => {
    const xml = serialize(el('LOAN', [leaf('X', 1)], { LoanRoleType: 'SubjectLoan', label: undefined }))
    expect(xml).toContain('<LOAN LoanRoleType="SubjectLoan">')
  })
})
