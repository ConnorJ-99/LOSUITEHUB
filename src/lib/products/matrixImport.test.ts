import { describe, expect, it } from 'vitest'
import * as M from '../../../supabase/functions/assistant/matrix'
import { approvalPayload, cellsFromGrid, cellsFromProgram, changeText, checkProgram, diffCells, matchProgram, parseSquare } from './matrixImport'
import { DOC_TYPES, FEATURES, LIENS, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, PRODUCT_FAMILIES, RULE_FIELDS, RULE_OPS } from './taxonomy'

/** A reading shaped like mockup 04's grid (fictional numbers): columns are occupancy, rows are credit bands. */
function reading(): unknown {
  return {
    effective_date: '2026-10-01',
    notes: '',
    programs: [
      {
        name: 'Conventional 30-Year Fixed',
        family: 'conventional',
        lien: 'first',
        doc_types: ['full_doc', 'magic_doc'],
        features: [],
        purposes: ['purchase', 'rate_term'],
        terms_months: [360],
        loan_amount_basis: 'this_lien',
        description: 'Agency fixed rate.',
        grids: [
          {
            page: 1,
            title: 'Purchase & R/T',
            ratio: 'ltv',
            occupancy: 'primary',
            property_types: ['sfr_pud', 'condo'],
            purposes: ['purchase', 'rate_term'],
            doc_type: 'full_doc',
            units_min: 1,
            units_max: 1,
            rows: [
              { label: '720+', fico_min: 720, fico_max: 850 },
              { label: '680-719', fico_min: 680, fico_max: 719 },
              { label: '620-679', fico_min: 620, fico_max: 679 },
            ],
            columns: [
              { label: 'Primary', loan_amount_min: 0, loan_amount_max: 806500, occupancy: null, units_min: null, units_max: null, purposes: null, property_types: null },
              { label: 'Investment', loan_amount_min: 0, loan_amount_max: 806500, occupancy: 'investment', units_min: null, units_max: null, purposes: ['purchase'], property_types: null },
            ],
            values: [
              [97, 85],
              [97, 80],
              [95, null],
            ],
            printed_rows: 3,
            printed_columns: 2,
            notes: '',
          },
        ],
        rules: [
          { field: 'dti', op: '<=', number: 50, list: null, min: null, max: null, applies_purposes: null, applies_occupancies: null, applies_ltv_above: null, severity: 'hard', message: 'Max DTI 50%', page: 3, quote: 'Maximum DTI 50%' },
          { field: 'first_time_buyer', op: 'required', number: null, list: null, min: null, max: null, applies_purposes: ['purchase'], applies_occupancies: null, applies_ltv_above: 95, severity: 'hard', message: 'Above 95% LTV, a first-time buyer', page: 11, quote: 'at least one borrower must be a first-time homebuyer' },
          { field: 'dti', op: '<=', number: null, list: null, min: null, max: null, applies_purposes: null, applies_occupancies: null, applies_ltv_above: null, severity: 'hard', message: 'Broken rule', page: 3, quote: '' },
        ],
      },
      { name: 'Mystery', family: 'crypto', lien: 'first', doc_types: [], features: [], purposes: [], terms_months: [], loan_amount_basis: 'this_lien', description: '', grids: [], rules: [] },
    ],
  }
}

describe('the matrix reader shares the taxonomy', () => {
  it('its word lists match the database lists', () => {
    expect([...M.FAMILIES]).toEqual(PRODUCT_FAMILIES.values)
    expect([...M.LIENS]).toEqual(LIENS.values)
    expect([...M.DOC_TYPES]).toEqual(DOC_TYPES.values)
    expect([...M.FEATURES]).toEqual(FEATURES.values)
    expect([...M.PURPOSES]).toEqual(MATRIX_PURPOSES.values)
    expect([...M.PROPERTY_TYPES]).toEqual(MATRIX_PROPERTY_TYPES.values)
    expect([...M.RULE_FIELDS]).toEqual(RULE_FIELDS.values)
    expect([...M.RULE_OPS]).toEqual([...RULE_OPS])
  })
})

describe('checking what the assistant read', () => {
  const r = M.normalizeMatrixReading(reading()) as M.MatrixReading

  it('keeps what fits the lists and lists what it dropped, never guessing', () => {
    expect(r.programs.map((p) => p.name)).toEqual(['Conventional 30-Year Fixed'])
    expect(r.programs[0].docTypes).toEqual(['full_doc'])
    expect(r.dropped).toEqual(['Conventional 30-Year Fixed doc type: "magic_doc"', 'Conventional 30-Year Fixed rule without a value: "Broken rule"', 'Program "Mystery": unknown product family or lien'])
    expect(r.effectiveDate).toBe('2026-10-01')
  })
  it('rules keep their quote, page and when they apply', () => {
    expect(r.programs[0].rules[1]).toEqual({ field: 'first_time_buyer', op: 'required', value: null, appliesWhen: { purposes: ['purchase'], ltv_above: 95 }, severity: 'hard', message: 'Above 95% LTV, a first-time buyer', page: 11, quote: 'at least one borrower must be a first-time homebuyer' })
  })
  it('finds the JSON in a reply, fenced or with a sentence around it', () => {
    expect(M.parseJsonReply('{"programs":[]}')).toEqual({ programs: [] })
    expect(M.parseJsonReply('Here it is:\n```json\n{"programs":[{"name":"A"}]}\n```')).toEqual({ programs: [{ name: 'A' }] })
    expect(M.parseJsonReply('no json here')).toBeNull()
    expect(M.parseJsonReply('{"programs": [')).toBeNull()
  })
  it('asks for the form in the request, with its lists', () => {
    expect(M.MATRIX_FORMAT_PROMPT).toContain('"term_options"')
    expect(M.MATRIX_FORMAT_PROMPT).toContain('heloc_10_20')
  })
  it('nothing usable is an error', () => {
    expect(M.normalizeMatrixReading({ programs: [] })).toEqual({ error: expect.stringContaining("couldn't find a loan program") })
  })
})

describe('cells from a grid', () => {
  const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
  const cells = cellsFromProgram(p)

  it('one cell per square; columns override the grid; a blank is not offered, never 0', () => {
    expect(cells).toHaveLength(6)
    expect(cells[1]).toMatchObject({ occupancy: 'investment', purposes: ['purchase'], propertyTypes: ['sfr_pud', 'condo'], ficoMin: 720, maxLtv: 85, offered: true, sourcePage: 1 })
    expect(cells[5]).toMatchObject({ occupancy: 'investment', ficoMin: 620, ficoMax: 679, offered: false, maxLtv: null, maxCltv: null })
  })
  it('a clean grid has no warnings', () => {
    expect(checkProgram(p)).toEqual([])
  })
})

describe('automatic checks', () => {
  const base = () => (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]

  it('a limit that goes up as the score goes down is flagged', () => {
    const p = base()
    p.grids[0].values[2][0] = 98
    expect(checkProgram(p).map((w) => w.message)).toEqual(['Purchase & R/T, Primary: 620–679 allows 98%, more than 97% at 680–719. Check the PDF.'])
  })
  it('impossible values and a wrong square count are errors', () => {
    const p = base()
    p.grids[0].values[0][0] = 105
    p.grids[0].values[1] = [97]
    p.grids[0].rows[2].ficoMin = 900
    const w = checkProgram(p)
    expect(w.filter((x) => x.level === 'error').map((x) => x.message)).toEqual([
      'Purchase & R/T: 5 squares read for 3 rows × 2 columns.',
      'Purchase & R/T: credit band "620-679" isn\'t possible (900–679).',
      "Purchase & R/T: LTV 105% at 720+ / Primary isn't possible.",
    ])
  })
  it('a printed size that differs from what was read is a warning', () => {
    const p = base()
    p.grids[0].printedRows = 4
    expect(checkProgram(p)).toEqual([{ level: 'warning', message: 'Purchase & R/T: the page shows 4 × 2, but 3 × 2 were read.', page: 1 }])
  })
  it('a bigger loan tier allowing more is flagged', () => {
    const p = base()
    p.grids[0].columns = [
      { label: '≤$1MM', loanAmountMin: 0, loanAmountMax: 1000000, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null },
      { label: '$1MM–$1.5MM', loanAmountMin: 1000001, loanAmountMax: 1500000, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null },
    ]
    p.grids[0].values = [
      [85, 84],
      [80, 82],
      [75, 70],
    ]
    expect(checkProgram(p).map((w) => w.message)).toEqual(['Purchase & R/T, 680–719: $1MM–$1.5MM allows 82%, more than 80% for the smaller ≤$1MM. Check the PDF.'])
  })
  it('a program with no doc type or no cells is an error', () => {
    const p = base()
    p.docTypes = []
    p.grids = []
    expect(checkProgram(p).map((w) => w.message)).toEqual(['Pick at least one doc type for the program.', 'The program has no matrix cells with a limit.'])
  })
})

describe('the difference from the version in use', () => {
  const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
  const current = cellsFromProgram(p)
  it('"Primary 680–719: 97% → 95%", plus cells newly offered or dropped', () => {
    const next = cellsFromProgram({ ...p, grids: [{ ...p.grids[0], values: [[97, 85], [95, 80], [95, 75]] }] })
    expect(diffCells(current, next).map(changeText)).toEqual([
      'Primary · SFR/PUD, Condo · Purchase, Rate/term · 680–719 · ≤$806,500: 97% → 95%',
      'Investment · SFR/PUD, Condo · Purchase · 620–679 · ≤$806,500: not offered → 75%',
    ])
    expect(diffCells(current, current)).toEqual([])
    expect(diffCells(current, next.slice(0, 4)).map(changeText).slice(-2)).toEqual(['Primary · SFR/PUD, Condo · Purchase, Rate/term · 620–679 · ≤$806,500: 95% → not in the matrix', 'Investment · SFR/PUD, Condo · Purchase · 620–679 · ≤$806,500: not offered → not in the matrix'])
  })
})

describe('one grid, several income types', () => {
  const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
  it('an older reading with one doc_type per grid still reads', () => {
    expect(p.grids[0].docTypes).toEqual(['full_doc'])
  })
  it('saves every box once per income type, so a search by any of them finds it', () => {
    const g = { ...p.grids[0], docTypes: ['bank_statement_12', 'asset_depletion', 'retirement_distribution'] as M.ReadGrid['docTypes'] }
    const cells = cellsFromGrid(g)
    expect(cells).toHaveLength(p.grids[0].rows.length * p.grids[0].columns.length * 3)
    expect([...new Set(cells.map((c) => c.docType))]).toEqual(['bank_statement_12', 'asset_depletion', 'retirement_distribution'])
    expect(checkProgram({ ...p, docTypes: ['bank_statement_12', 'asset_depletion', 'retirement_distribution'], grids: [g] }).filter((w) => w.level === 'error')).toEqual([])
  })
  it('reads doc_types and asks the AI to list them all', () => {
    const raw = reading() as { programs: { grids: Record<string, unknown>[] }[] }
    const { doc_type: _d, ...grid } = raw.programs[0].grids[0]
    raw.programs[0].grids = [{ ...grid, doc_types: ['bank_statement_12', 'asset_depletion', 'retirement_distribution'] }]
    const r = M.normalizeMatrixReading(raw) as M.MatrixReading
    expect(r.programs[0].grids[0].docTypes).toEqual(['bank_statement_12', 'asset_depletion', 'retirement_distribution'])
    expect(M.MATRIX_SYSTEM_PROMPT).toContain('list every one in doc_types')
  })
  it('a grid with no income type is an error', () => {
    expect(checkProgram({ ...p, grids: [{ ...p.grids[0], docTypes: [] }] }).some((w) => w.level === 'error' && w.message.includes('no income type'))).toBe(true)
  })
})

describe('approval', () => {
  const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
  it('only included programs, with every square as a cell and every rule with its quote', () => {
    const payload = approvalPayload([{ ...p, include: true, programId: 'existing-id' }, { ...p, name: 'Skipped', include: false, programId: null }])
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({ program_id: 'existing-id', name: 'Conventional 30-Year Fixed', doc_types: ['full_doc'] })
    expect(payload[0].cells).toHaveLength(6)
    expect(payload[0].cells[5]).toMatchObject({ occupancy: 'investment', offered: false, max_ltv: null, source_page: 1 })
    expect(payload[0].rules[0]).toEqual({ field: 'dti', op: '<=', value: 50, applies_when: null, severity: 'hard', message: 'Max DTI 50%', source_page: 3, source_quote: 'Maximum DTI 50%' })
  })
  it('saves the term options, with their months for older screens', () => {
    expect(p.termOptions).toEqual(['fixed_30'])
    const payload = approvalPayload([{ ...p, termOptions: ['fixed_30', 'fixed_15', 'arm_7_6'], include: true, programId: null }])
    expect(payload[0]).toMatchObject({ term_options: ['fixed_30', 'fixed_15', 'arm_7_6'], terms_months: [360, 180] })
  })
  it('reads term options and drops ones not on the list', () => {
    const r = M.normalizeMatrixReading({ programs: [{ name: 'HELOC', family: 'non_qm', lien: 'heloc', doc_types: ['full_doc'], features: [], purposes: ['cash_out'], term_options: ['heloc_10_20', 'heloc_99_1'], loan_amount_basis: 'combined', description: '', grids: [], rules: [] }] }) as M.MatrixReading
    expect(r.programs[0].termOptions).toEqual(['heloc_10_20'])
    expect(r.dropped).toEqual(['HELOC term: "heloc_99_1"'])
  })
  it('a newer matrix updates the program with the same name', () => {
    expect(matchProgram('Conventional 30-Year  Fixed', [{ id: 'a', name: 'conventional 30 year fixed' }])).toBe('a')
    expect(matchProgram('FHA 30', [{ id: 'a', name: 'Conventional 30' }])).toBeNull()
  })
  it('typed squares: blank or a dash is not offered, never 0', () => {
    expect(parseSquare('')).toBeNull()
    expect(parseSquare('—')).toBeNull()
    expect(parseSquare('N/A')).toBeNull()
    expect(parseSquare('97%')).toBe(97)
    expect(parseSquare('abc')).toBe('invalid')
  })
})
