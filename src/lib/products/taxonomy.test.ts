import { describe, expect, it } from 'vitest'
import * as M from '../../../supabase/functions/assistant/matrix'
import {
  CITIZENSHIPS,
  DOC_TYPES,
  FEATURES,
  LENDER_CHANNELS,
  LENDER_STATUSES,
  LIENS,
  MATRIX_PROPERTY_TYPES,
  MATRIX_PURPOSES,
  PRODUCT_FAMILIES,
  RULE_FIELDS,
  RULE_OPS,
  citizenshipFor,
  docTypeFor,
  lienFor,
  matrixPropertyTypeFor,
  matrixPurposeFor,
  TERM_OPTIONS,
  termMonths,
  termsSummary,
} from './taxonomy'

const scripts = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
const sql = Object.values(scripts).join('\n')
/** Values of a database enum: created, plus any later "add value". */
function dbEnum(name: string): string[] {
  const created = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`).exec(sql)
  expect(created, `enum ${name}`).not.toBeNull()
  const added = [...sql.matchAll(new RegExp(`alter type public\\.${name} add value if not exists '([a-z_0-9<>=]+)'`, 'g'))].map((m) => m[1])
  return [...created![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).concat(added)
}

describe('taxonomy', () => {
  it('matches the database enums exactly', () => {
    expect(dbEnum('product_family')).toEqual(PRODUCT_FAMILIES.values)
    expect(dbEnum('product_lien')).toEqual(LIENS.values)
    expect(dbEnum('product_doc_type')).toEqual(DOC_TYPES.values)
    expect(dbEnum('product_feature')).toEqual(FEATURES.values)
    expect(dbEnum('matrix_purpose')).toEqual(MATRIX_PURPOSES.values)
    expect(dbEnum('matrix_property_type')).toEqual(MATRIX_PROPERTY_TYPES.values)
    // Real Non-QM matrices print Condotel and rural SFR grids.
    expect(MATRIX_PROPERTY_TYPES.values).toEqual(expect.arrayContaining(['condotel', 'rural']))
    expect(dbEnum('lender_status')).toEqual(LENDER_STATUSES.values)
    expect(dbEnum('lender_channel')).toEqual(LENDER_CHANNELS.values)
    expect(dbEnum('rule_field')).toEqual(RULE_FIELDS.values)
    expect(dbEnum('rule_op')).toEqual([...RULE_OPS])
    expect(dbEnum('product_citizenship')).toEqual(CITIZENSHIPS.values)
    expect(dbEnum('program_term')).toEqual(TERM_OPTIONS.values)
    expect([...M.TERMS]).toEqual(TERM_OPTIONS.values)
  })
  it('summarizes term options and their months', () => {
    expect(termsSummary(['fixed_15', 'arm_7_6', 'fixed_30', 'fixed_25'])).toBe('30, 25, 15-yr fixed · 7/6 ARM')
    expect(termsSummary(['heloc_10_20'])).toBe('HELOC 10/20')
    expect(termsSummary([])).toBe('')
    expect([termMonths('fixed_15'), termMonths('arm_5_6'), termMonths('heloc_10_20')]).toEqual([180, 360, 360])
  })
  it('maps a borrower file onto the taxonomy', () => {
    expect(lienFor('heloc')).toBe('heloc')
    expect(lienFor('heloan')).toBe('ces')
    expect(lienFor('investment_dscr')).toBe('first')
    expect(matrixPurposeFor('refinance_rate_term')).toBe('rate_term')
    expect(matrixPurposeFor('heloan')).toBe('cash_out')
    expect(matrixPropertyTypeFor('townhouse', 1)).toBe('sfr_pud')
    expect(matrixPropertyTypeFor('single_family', 4)).toBe('two_to_four')
    expect(matrixPropertyTypeFor('condo', 1, true)).toBe('non_warrantable_condo')
    expect(matrixPropertyTypeFor(null, null)).toBeNull()
    expect(docTypeFor('bank_statement', 24)).toBe('bank_statement_24')
    expect(docTypeFor(null)).toBe('full_doc')
    expect(citizenshipFor('permanent_resident_alien')).toBe('permanent_resident')
    expect(citizenshipFor(null)).toBe('us_citizen')
  })
})
