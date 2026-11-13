import { describe, expect, it } from 'vitest'
import { hotKeyFor, hotKeyLabel, hotKeysOf, isHotFor } from './hot'

const newfi = { family: 'non_qm' as const, docTypes: ['full_doc', 'bank_statement_12', 'bank_statement_24', 'dscr'] as ('full_doc' | 'bank_statement_12' | 'bank_statement_24' | 'dscr')[] }

describe('hot programs per qualifying type', () => {
  it('agency programs by family; Non-QM by income type, 12 and 24 month bank statements as one', () => {
    expect(hotKeysOf({ family: 'fha', docTypes: ['full_doc'] })).toEqual(['fha'])
    expect(hotKeysOf(newfi)).toEqual(['full_doc', 'bank_statement', 'dscr'])
    expect(hotKeysOf(newfi).map(hotKeyLabel)).toEqual(['Full doc', 'Bank statement', 'DSCR'])
  })
  it("Connor's example: Newfi Non-QM is Hot for bank statement, not for DSCR", () => {
    expect(hotKeyFor(newfi, { docType: 'bank_statement_24' })).toBe('bank_statement')
    expect(isHotFor(newfi, ['bank_statement'], { docType: 'bank_statement_12' })).toBe(true)
    expect(isHotFor(newfi, ['bank_statement'], { docType: 'dscr' })).toBe(false)
    expect(isHotFor({ family: 'conventional' }, ['conventional'], { docType: 'full_doc' })).toBe(true)
    expect(isHotFor({ family: 'conventional' }, undefined, { docType: 'full_doc' })).toBe(false)
  })
})
