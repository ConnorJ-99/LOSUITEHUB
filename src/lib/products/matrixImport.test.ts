import { describe, expect, it } from 'vitest'
import * as M from '../../../supabase/functions/assistant/matrix'
import * as M2 from './matrixImport'
import { approvalPayload, cellsFromGrid, cellsFromProgram, defaultMode, mergedProgram, repairProgram, type ProgramNow, changeText, checkProgram, diffCells, matchProgram, parseSquare } from './matrixImport'
import { evaluateProgram } from './engine'
import { lender, program as catalogProgram, scenario } from './testCatalog'
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
    p.grids[0].values[0][0] = 155
    p.grids[0].values[1] = [97]
    p.grids[0].rows[2].ficoMin = 900
    const w = checkProgram(p)
    expect(w.filter((x) => x.level === 'error').map((x) => x.message)).toEqual([
      'Purchase & R/T: 5 squares read for 3 rows × 2 columns.',
      'Purchase & R/T: credit band "620-679" isn\'t possible (900–679).',
      "Purchase & R/T: LTV 155% at 720+ / Primary isn't possible.",
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
  it('no doc type blocks approval; no grid only warns (the program is saved without limits)', () => {
    const p = base()
    p.docTypes = []
    p.grids = []
    const w = checkProgram(p)
    expect(w.filter((x) => x.level === 'error').map((x) => x.message)).toEqual(['Pick at least one doc type for the program.'])
    expect(w.filter((x) => x.level === 'warning').map((x) => x.message)[0]).toContain('No matrix grid')
  })
  it('limits over 100% (FHA streamline 110%) are allowed; over 150% is a misread', () => {
    const p = base()
    p.grids[0].values[0][0] = 110
    expect(checkProgram(p).some((w) => w.level === 'error')).toBe(false)
    p.grids[0].values[0][0] = 160
    expect(checkProgram(p).some((w) => w.level === 'error')).toBe(true)
  })
})

describe('fixing what real matrices trip on', () => {
  const base = () => (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
  it('leaves out "No FICO" rows, names Condotel and rural grids, and fills a missing income type', () => {
    const p = base()
    const g = p.grids[0]
    const noFico = { ...g, title: 'DSCR - Investment / Condotel', propertyTypes: [], rows: [...g.rows, { label: 'No FICO', ficoMin: 0, ficoMax: 0 }], values: [...g.values, g.values[0].map(() => 70)] }
    const rural = { ...g, title: 'Prime / SFR Rural', propertyTypes: [] }
    const { program, fixes } = repairProgram({ ...p, docTypes: [], grids: [noFico, rural] })
    expect(program.grids[0].rows.map((r: M.GridRow) => r.label)).toEqual(g.rows.map((r: M.GridRow) => r.label))
    expect(program.grids[0].values).toHaveLength(g.rows.length)
    expect(program.grids[0].propertyTypes).toEqual(['condotel'])
    expect(program.grids[1].propertyTypes).toEqual(['rural'])
    expect(program.docTypes).toEqual(g.docTypes)
    expect(fixes).toHaveLength(4)
    expect(checkProgram(program).filter((w) => w.level === 'error')).toEqual([])
  })
  it('keeps a single "all credit scores" row (A&D Fannie Mae: no score bands printed)', () => {
    const p = base()
    const g = p.grids[0]
    const all = { ...g, rows: [{ label: 'All credit scores (no credit-score bands printed; credit score per DU)', ficoMin: 300, ficoMax: 850 }], values: [g.values[0]] }
    const { program, fixes } = repairProgram({ ...p, grids: [all] })
    expect(program.grids[0].rows).toHaveLength(1)
    expect(fixes).toEqual([])
    // Rows with a score range stay, whatever the label; a bare "No FICO" row beside them goes.
    const labeled = (label: string, ficoMin: number) => ({ label, ficoMin, ficoMax: 850 })
    const mixed = { ...g, rows: [labeled('680+ / No FICO', 680), labeled('No FICO score required. Evaluated by AUS', 300), labeled('No FICO', 300)], values: [g.values[0], g.values[0], g.values[0]] }
    // (The stacked "680+" and "300+" rows stay as printed: they're minimum scores.)
    expect(repairProgram({ ...p, grids: [mixed] }).program.grids[0].rows.map((r: M.GridRow) => [r.ficoMin, r.ficoMax])).toEqual([[680, 850], [300, 850]])
    // Even a grid of only "No FICO" rows keeps them rather than vanishing (the checks flag it instead).
    const onlyNoFico = { ...g, rows: [{ label: 'No FICO', ficoMin: 0, ficoMax: 0 }], values: [g.values[0]] }
    expect(repairProgram({ ...p, grids: [onlyNoFico] }).program.grids[0].rows).toHaveLength(1)
  })
  it("reads a grid's DSCR level from its title when grids differ by DSCR", () => {
    expect(M2.dscrFromTitle('Investment Properties: Max LTV/CLTV | DSCR > 1')).toBe(1)
    expect(M2.dscrFromTitle('DSCR ≥ 1.25 Max LTV')).toBe(1.25)
    expect(M2.dscrFromTitle('DSCR 1.00+')).toBe(1)
    expect(M2.dscrFromTitle('.75 - .99² Max LTV / CLTV')).toBe(0.75)
    expect(M2.dscrFromTitle('DSCR < 0.75 / No Ratio')).toBe(0)
    expect(M2.dscrFromTitle('Primary · Purchase')).toBeNull()
    const p = base()
    const g = { ...p.grids[0], occupancy: 'investment' as const }
    const two = { ...p, grids: [{ ...g, title: 'Investment Properties: Max LTV/CLTV | DSCR > 1' }, { ...g, title: '.75 - .99² Max LTV / CLTV' }] }
    expect(checkProgram(two).some((w) => w.level === 'error')).toBe(true)
    const { program, fixes } = repairProgram(two)
    expect(program.grids.map((x: M.ReadGrid) => x.dscrMin)).toEqual([1, 0.75])
    expect(fixes.filter((f) => f.includes('DSCR'))).toHaveLength(2)
    expect(checkProgram(program).filter((w) => w.level === 'error')).toEqual([])
    expect(new Set(cellsFromProgram(program).map((c) => c.dscrMin))).toEqual(new Set([1, 0.75]))
  })
  it('a 5–8 or 5–9 unit grid becomes "5+ units"', () => {
    const p = base()
    const g = { ...p.grids[0], occupancy: 'investment' as const }
    const { program, fixes } = repairProgram({ ...p, grids: [{ ...g, title: 'DSCR 5-9 Unit | Eligibility Matrix', propertyTypes: [] }, { ...g, title: 'Investment Property (5-8) Units', propertyTypes: ['two_to_four'], unitsMin: 5, unitsMax: 8 }] })
    expect(program.grids.map((x: M.ReadGrid) => [x.propertyTypes, x.unitsMin, x.unitsMax])).toEqual([[['five_plus'], 5, 9], [['five_plus'], 5, 8]])
    expect(fixes.filter((f) => f.includes('5+ units'))).toHaveLength(2)
    expect(checkProgram(program).filter((w) => w.level === 'error')).toEqual([])
  })
  it('leaves a clean reading alone', () => {
    const p = base()
    expect(repairProgram(p)).toEqual({ program: p, fixes: [] })
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
    const payload = approvalPayload([{ ...p, include: true, programId: 'existing-id', mode: 'replace' }, { ...p, name: 'Skipped', include: false, programId: null, mode: 'replace' }])
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({ program_id: 'existing-id', name: 'Conventional 30-Year Fixed', doc_types: ['full_doc'] })
    expect(payload[0].cells).toHaveLength(6)
    expect(payload[0].cells[5]).toMatchObject({ occupancy: 'investment', offered: false, max_ltv: null, source_page: 1 })
    expect(payload[0].rules[0]).toEqual({ field: 'dti', op: '<=', value: 50, applies_when: null, severity: 'hard', message: 'Max DTI 50%', source_page: 3, source_quote: 'Maximum DTI 50%' })
  })
  it('saves the term options, with their months for older screens', () => {
    expect(p.termOptions).toEqual(['fixed_30'])
    const payload = approvalPayload([{ ...p, termOptions: ['fixed_30', 'fixed_15', 'arm_7_6'], include: true, programId: null, mode: 'replace' }])
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

describe('one product, several documents', () => {
  const p = { ...(M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0], family: 'fha' as const }
  const matrixCells = cellsFromProgram(p)
  const now = (over: Partial<ProgramNow> = {}): ProgramNow => ({ id: 'fha', name: 'FHA', cells: matrixCells, rules: p.rules, docTypes: ['full_doc'], purposes: ['purchase', 'rate_term'], features: [], termOptions: ['fixed_30'], description: null, sourceDocumentId: 'matrix-pdf', ...over })
  const dti45 = { field: 'dti', op: '<=', value: 45, appliesWhen: null, severity: 'hard', message: 'Max DTI 45%', page: 12, quote: 'Max DTI 45%' } as M.ReadRule
  it('guidelines without limits add their rules and terms; the matrix limits stay', () => {
    const guide = { ...p, grids: [], rules: [dti45], termOptions: ['fixed_15'] as M.ReadProgram['termOptions'], include: true, programId: 'fha', mode: 'merge' as const }
    const m = mergedProgram(guide, now())
    expect(m.cells).toHaveLength(matrixCells.length)
    expect(m.rules.map((r) => r.message)).toEqual([...p.rules.map((r) => r.message), 'Max DTI 45%'])
    expect(m.termOptions).toEqual(['fixed_30', 'fixed_15'])
  })
  it('a max LTV grid and a max CLTV grid for the same loans become one set of limits, not a clash', () => {
    const ltv = { ...p.grids[0], ratio: 'ltv' as const, title: 'Purchase (Max LTV)' }
    const cltv = { ...p.grids[0], ratio: 'cltv' as const, title: 'Purchase (Max CLTV)', values: p.grids[0].values.map((row) => row.map((v) => (v == null ? v : v + 5))) }
    const both = { ...p, grids: [ltv, cltv] }
    expect(checkProgram(both).filter((w) => w.level === 'error')).toEqual([])
    const cells = cellsFromProgram(both)
    expect(cells).toHaveLength(cellsFromGrid(ltv).length)
    const offered = cells.filter((c) => c.offered)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((c) => c.maxLtv != null && c.maxCltv === c.maxLtv + 5)).toBe(true)
    // Two LTV grids for the same loans are still a mistake to fix.
    expect(checkProgram({ ...p, grids: [ltv, { ...ltv, title: 'Copy' }] }).some((w) => w.level === 'error')).toBe(true)
  })
  it('Conventional: where Fannie Mae and Freddie Mac both cover a loan, the higher limit stays', () => {
    const conv = { ...p, family: 'conventional' as const }
    const fannie = cellsFromProgram({ ...conv, grids: [{ ...p.grids[0], values: p.grids[0].values.map((row) => row.map((v) => (v == null ? v : 97))) }] })
    const freddie = { ...conv, grids: [{ ...p.grids[0], values: p.grids[0].values.map((row) => row.map((v) => (v == null ? v : 95))) }], include: true, programId: 'conv', mode: 'merge' as const }
    const m = mergedProgram(freddie, now({ cells: fannie }))
    expect(m.cells.length).toBeGreaterThanOrEqual(fannie.length)
    expect(new Set(m.cells.filter((c) => c.offered).map((c) => c.maxLtv ?? c.maxCltv))).toEqual(new Set([97]))
    // Other loan types: the newer document's limit takes over.
    expect(new Set(mergedProgram({ ...freddie, family: 'fha' }, now({ cells: fannie })).cells.filter((c) => c.offered).map((c) => c.maxLtv ?? c.maxCltv))).toEqual(new Set([95]))
  })
  it("a second matrix PDF adds its grids; boxes it also covers take the new limits", () => {
    const second = { ...p, grids: [{ ...p.grids[0], purposes: ['cash_out'] as M.ReadGrid['purposes'] }], include: true, programId: 'fha', mode: 'merge' as const }
    const m = mergedProgram(second, now())
    expect(m.cells.length).toBeGreaterThan(matrixCells.length)
    expect(m.cells.some((c) => c.purposes.includes('cash_out'))).toBe(true)
    expect(m.cells.filter((c) => c.purposes.join() === 'purchase,rate_term')).toHaveLength(matrixCells.filter((c) => c.purposes.join() === 'purchase,rate_term').length)
    expect(m.purposes).toEqual(['purchase', 'rate_term', 'cash_out'])
    const same = { ...p, include: true, programId: 'fha', mode: 'merge' as const }
    expect(mergedProgram(same, now()).cells).toHaveLength(matrixCells.length)
  })
  it('replace makes the reading the whole matrix', () => {
    const r = mergedProgram({ ...p, grids: [], include: true, programId: 'fha', mode: 'replace' }, now())
    expect(r.cells).toEqual([])
  })
  it('adds by default, and replaces only a newer copy of the same document', () => {
    expect(defaultMode(p, now(), 'other-pdf')).toBe('merge')
    expect(defaultMode(p, now(), 'matrix-pdf')).toBe('replace')
    expect(defaultMode({ grids: [] }, now(), 'matrix-pdf')).toBe('merge')
    expect(defaultMode(p, undefined, 'x')).toBe('replace')
  })
  it('matches names across documents, ignoring the lender and filler words, but keeps variants apart', () => {
    const existing = [{ id: 'fha', name: 'FHA' }, { id: 'stream', name: 'FHA Streamline' }, { id: 'bs', name: 'Bank Statement Advantage' }]
    expect(matchProgram('AmWest FHA Program', existing, 'AmWest')).toBe('fha')
    expect(matchProgram('FHA Streamline Matrix', existing, 'AmWest')).toBe('stream')
    expect(matchProgram('AmWest Bank Statement Advantage Program', existing, 'AmWest')).toBe('bs')
    expect(matchProgram('FHA with DPA', existing, 'AmWest')).toBeNull()
    expect(matchProgram('Program Matrix', existing, 'AmWest')).toBeNull()
  })
})

describe('a matrix fills in the existing product', () => {
  const existing = [
    { id: 'fha', name: 'FHA', family: 'fha' as const, lien: 'first' as const },
    { id: 'stream', name: 'FHA Streamline', family: 'fha' as const, lien: 'first' as const },
    { id: 'dscr', name: 'DSCR', family: 'non_qm' as const, lien: 'first' as const },
    { id: 'dscr2', name: 'DSCR Closed-End Second', family: 'non_qm' as const, lien: 'ces' as const },
  ]
  const fha = { family: 'fha' as const, lien: 'first' as const }
  it('a longer name for the same product still matches', () => {
    expect(matchProgram('FHA 203(b) Standard', existing, 'A&D Mortgage', fha)).toBe('fha')
    expect(matchProgram('A&D FHA Product Matrix', existing, 'A&D Mortgage', fha)).toBe('fha')
    expect(matchProgram('FHA Streamline Refinance', existing, 'A&D Mortgage', fha)).toBe('stream')
  })
  it('a different product of the same loan type does not', () => {
    expect(matchProgram('FHA with DPA', existing, 'A&D Mortgage', fha)).toBeNull()
    expect(matchProgram('FHA 203k Renovation', existing, 'A&D Mortgage', fha)).toBeNull()
    expect(matchProgram('DSCR Matrix', existing, 'A&D Mortgage', { family: 'non_qm', lien: 'ces' })).toBeNull()
    expect(matchProgram('DSCR 5-8 Unit', existing, 'A&D Mortgage', { family: 'non_qm', lien: 'first' })).toBeNull()
    expect(matchProgram('FHA', existing, 'A&D Mortgage', { family: 'va', lien: 'first' })).toBeNull()
  })
  it('a reading opens fixed, matched and named like the product it fills in; errors and double matches block approving it unseen', () => {
    const r = M.normalizeMatrixReading(reading()) as M.MatrixReading
    const conv = { family: 'conventional' as const, lien: 'first' as const, active: true, cells: [], rules: [], docTypes: [], purposes: [], features: [], termOptions: [], description: null, sourceDocumentId: null }
    const fannie = { ...r, programs: [{ ...r.programs[0], name: 'Fannie Mae Standard' }] }
    const opened = M2.reviewReading(fannie, { pending: true, lenderName: 'A&D Mortgage', documentId: 'pdf', existing: [{ ...conv, id: 'conv', name: 'Conventional' }] })
    expect(opened.programs[0]).toMatchObject({ programId: 'conv', name: 'Conventional', mode: 'merge', include: true })
    expect(M2.approvalBlockers(opened.programs)).toEqual([])
    // A retired product isn't filled in.
    expect(M2.reviewReading(fannie, { pending: true, lenderName: '', documentId: 'pdf', existing: [{ ...conv, id: 'conv', name: 'Conventional', active: false }] }).programs[0].programId).toBeNull()
    // Two programs filling in the same product need a look.
    const twice = { ...r, programs: [fannie.programs[0], { ...fannie.programs[0], name: 'Freddie Mac Standard' }] }
    const both = M2.reviewReading(twice, { pending: true, lenderName: '', documentId: 'pdf', existing: [{ ...conv, id: 'conv', name: 'Conventional' }] }).programs
    expect(M2.approvalBlockers(both)).toContain('Two programs in this reading fill in the same product.')
    const broken = { ...opened.programs[0], grids: [{ ...opened.programs[0].grids[0], propertyTypes: [], columns: opened.programs[0].grids[0].columns.map((c) => ({ ...c, propertyTypes: null })) }] }
    expect(M2.approvalBlockers([broken]).length).toBeGreaterThan(0)
  })
  it('Fannie Mae and Freddie Mac matrices fill in the Conventional product; HomeReady and the rest stay their own', () => {
    const conv = { family: 'conventional' as const, lien: 'first' as const }
    const programs = [
      { id: 'conv', name: 'Conventional', ...conv },
      { id: 'hr', name: 'HomeReady', ...conv },
      { id: 'hp', name: 'Home Possible', ...conv },
    ]
    expect(matchProgram('Fannie Mae Standard Eligibility', programs, 'A&D Mortgage', conv)).toBe('conv')
    expect(matchProgram('Freddie Mac – Standard Eligibility', programs, 'A&D Mortgage', conv)).toBe('conv')
    expect(matchProgram('Fannie Mae (DU) Conventional Conforming', programs, 'A&D Mortgage', conv)).toBe('conv')
    expect(matchProgram('Fannie Mae HomeReady', programs, 'A&D Mortgage', conv)).toBe('hr')
    expect(matchProgram('Freddie Mac Home Possible', programs, 'A&D Mortgage', conv)).toBe('hp')
    expect(matchProgram('Freddie Mac Refi Possible', programs, 'A&D Mortgage', conv)).toBeNull()
    expect(matchProgram('Freddie Mac HomeOne', programs, 'A&D Mortgage', conv)).toBeNull()
    // Two plain Conventional products: ambiguous, so it asks rather than guessing.
    expect(matchProgram('Fannie Mae', [...programs, { id: 'fn', name: 'Fannie Mae Standard Eligibility', ...conv }], 'A&D Mortgage', conv)).toBeNull()
    // Agency words only count for Conventional.
    expect(matchProgram('Standard', [{ id: 'fha', name: 'FHA', family: 'fha', lien: 'first' }], 'A&D Mortgage', { family: 'fha', lien: 'first' })).toBeNull()
  })
})

describe('rule values the search can compare', () => {
  const rule = (field: M.ReadRule['field'], value: string[], op: M.ReadRule['op'] = 'in') => ({ field, op, value, appliesWhen: null, severity: 'hard', message: 'x', page: 2, quote: '' }) as M.ReadRule
  it('citizenship words become codes', () => {
    expect(M.cleanRule(rule('citizenship', ['US Citizen', 'Permanent Resident']))?.value).toEqual(['us_citizen', 'permanent_resident'])
    expect(M.cleanRule(rule('citizenship', ['Non-Permanent Resident Alien', 'ITIN']))?.value).toEqual(['non_permanent_resident', 'itin'])
  })
  it('"all states" is no rule; state names that are not codes are dropped', () => {
    expect(M.cleanRule(rule('state', ['US (all states including DC)']))).toBeNull()
    expect(M.cleanRule(rule('state', ['tx', 'Oklahoma', 'FL']))?.value).toEqual(['TX', 'FL'])
    expect(M.cleanRule(rule('state', ['VI'], 'not_in'))?.value).toEqual(['VI'])
  })
  it('other rules pass through', () => {
    const r = { ...rule('dti', []), op: '<=', value: 50 } as M.ReadRule
    expect(M.cleanRule(r)).toBe(r)
  })
})

describe('stacked "580+ / 620+ / 640+" rows', () => {
  it('are minimum scores, kept as printed (never turned into 580–619 bands)', () => {
    const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
    const g = { ...p.grids[0], rows: [{ label: '580+', ficoMin: 580, ficoMax: 850 }, { label: '620+', ficoMin: 620, ficoMax: 850 }, { label: '640+', ficoMin: 640, ficoMax: 850 }] }
    const { program, fixes } = repairProgram({ ...p, grids: [g] })
    expect(program.grids[0].rows.map((r) => [r.ficoMin, r.ficoMax])).toEqual([[580, 850], [620, 850], [640, 850]])
    expect(program.grids[0].creditScores).toBe('minimums')
    expect(fixes[0]).toContain('580+, 620+, 640+ read as minimum scores')
    expect(cellsFromGrid(program.grids[0]).every((c) => c.creditMode === 'minimums' && c.blankMode === 'not_specified')).toBe(true)
  })
})

describe('loan amount columns read from $0', () => {
  it('"≤ $750K, ≤ $1M, ≤ $1.5M" are maximums, all from $0 (never "one dollar above")', () => {
    const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
    const col = (label: string, max: number) => ({ label, loanAmountMin: 0, loanAmountMax: max, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null })
    const g = { ...p.grids[0], columns: [col('≤ $750,000', 750000), col('≤ $1,000,000', 1000000), col('≤ $1,500,000', 1500000)], values: p.grids[0].rows.map(() => [80, 75, 70]) }
    const { program, fixes } = repairProgram({ ...p, grids: [g] })
    expect(program.grids[0].columns.map((c) => [c.loanAmountMin, c.loanAmountMax])).toEqual([[0, 750000], [0, 1000000], [0, 1500000]])
    expect(program.grids[0].loanAmounts).toBe('max_tiers')
    expect(fixes.some((f) => f.includes('read as maximums'))).toBe(true)
    expect(M2.gridSettings(program.grids[0])).toEqual({ loanAmounts: 'max_tiers', creditScores: 'bands', blankCells: 'not_specified' })
  })
  it('a reading made under the old rule (labels say "≤", amounts start a dollar above the tier before) goes back to maximums', () => {
    const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
    const col = (label: string, min: number, max: number) => ({ label, loanAmountMin: min, loanAmountMax: max, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null })
    const g = { ...p.grids[0], columns: [col('≤ $750K', 0, 750000), col('≤ $1MM', 750001, 1000000), col('≤ $1.5MM', 1000001, 1500000)], values: p.grids[0].rows.map(() => [80, 75, 70]) }
    expect(repairProgram({ ...p, grids: [g] }).program.grids[0].columns.map((c) => [c.loanAmountMin, c.loanAmountMax])).toEqual([[0, 750000], [0, 1000000], [0, 1500000]])
    // Printed ranges stay ranges.
    const ranges = { ...g, columns: [col('≤ $750K', 0, 750000), col('$750,001 - $1MM', 750001, 1000000), col('$1MM+ to $1.5MM', 1000001, 1500000)] }
    const kept = repairProgram({ ...p, grids: [ranges] })
    expect(kept.program.grids[0].columns.map((c) => c.loanAmountMin)).toEqual([0, 750001, 1000001])
    expect(M2.gridSettings(kept.program.grids[0])).toEqual({ loanAmounts: 'explicit_ranges', creditScores: 'bands', blankCells: 'not_offered' })
  })
  it('tells a maximum label from a range label', () => {
    for (const label of ['≤ $1MM', 'Up to $750K', '$1,500,000', 'Max $2.5M', '<= 1,000,000']) expect(M2.labeledAsMaximum(label), label).toBe(true)
    for (const label of ['$500,001 - $1MM', '$1MM+ to $1.5MM', '> $1,500,000', '$3MM+', 'Primary', 'Over $1M']) expect(M2.labeledAsMaximum(label), label).toBe(false)
  })
  it('columns that differ by occupancy are left alone', () => {
    const p = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0]
    expect(repairProgram(p).program.grids[0].columns).toEqual(p.grids[0].columns)
  })
  it('"Refi Now" and "RefiNow" are the same program', () => {
    expect(matchProgram('Refi Now', [{ id: 'r', name: 'RefiNow', family: 'conventional', lien: 'first' }], 'A&D', { family: 'conventional', lien: 'first' })).toBe('r')
  })
})

// The DSCR ≥ 1.00 matrix from the tier fix, as the reader returns it: the lender's rows, nothing filled in.
function rowListReading(over: Record<string, unknown> = {}): unknown {
  const rows: [number, number, number, number][] = [
    [500000, 640, 75, 70],
    [1000000, 720, 80, 80],
    [1500000, 700, 80, 75],
    [1500000, 660, 75, 70],
    [2000000, 700, 75, 70],
    [2000000, 660, 70, 65],
    [2500000, 700, 70, 65],
    [2500000, 660, 65, 60],
    [3000000, 720, 70, 65],
    [3000000, 700, 65, 60],
    [3000000, 660, 60, 60],
  ]
  return {
    effective_date: '2026-11-01',
    notes: '',
    programs: [
      {
        name: 'DSCR',
        family: 'non_qm',
        lien: 'first',
        doc_types: ['dscr'],
        features: [],
        purposes: ['purchase', 'rate_term', 'cash_out'],
        term_options: ['fixed_30'],
        loan_amount_basis: 'this_lien',
        description: '',
        grids: [
          {
            page: 2,
            title: 'DSCR >= 1.00',
            ratio: 'ltv',
            occupancy: 'investment',
            property_types: ['sfr_pud'],
            purposes: ['purchase', 'rate_term', 'cash_out'],
            doc_types: ['dscr'],
            units_min: 1,
            units_max: 4,
            dscr_min: 1,
            rows: [],
            columns: [],
            values: [],
            printed_rows: 0,
            printed_columns: 0,
            notes: '',
            loan_amounts: 'max_tiers',
            credit_scores: 'minimums',
            blank_cells: 'not_specified',
            ambiguous: false,
            ambiguous_reason: '',
            row_list: {
              value_columns: [
                { label: 'Purchase / R&T', purposes: ['purchase', 'rate_term'] },
                { label: 'Cash-out', purposes: ['cash_out'] },
              ],
              rows: rows.map(([loan_amount_max, fico_min, prt, co]) => ({ loan_amount_max, fico_min, values: [prt, co], notes: '' })),
            },
            ...over,
          },
        ],
        rules: [
          { field: 'loan_amount', op: '>=', number: 125000, list: null, min: null, max: null, applies_purposes: null, applies_occupancies: null, applies_ltv_above: null, applies_loan_amount_below: null, applies_states: null, applies_property_types: null, severity: 'hard', message: 'Minimum loan amount $125,000', page: 2, quote: 'Min loan $125,000' },
          { field: 'ltv', op: '<=', number: 70, list: null, min: null, max: null, applies_purposes: null, applies_occupancies: null, applies_ltv_above: null, applies_loan_amount_below: 150000, applies_states: null, applies_property_types: null, severity: 'hard', message: 'Loan amounts under $150,000 max 70% LTV', page: 2, quote: 'Loan amounts < $150,000 max 70% LTV' },
          { field: 'ltv', op: '<=', number: 75, list: null, min: null, max: null, applies_purposes: null, applies_occupancies: null, applies_ltv_above: null, applies_loan_amount_below: null, applies_states: ['fl', 'Florida'], applies_property_types: ['condo', 'castle'], severity: 'hard', message: 'Florida condos max 75% LTV', page: 2, quote: 'Florida condos max 75%' },
        ],
      },
    ],
  }
}

describe('a row-list matrix: the lender’s rows are the source, the grid is generated from them', () => {
  const read = M.normalizeMatrixReading(rowListReading()) as M.MatrixReading
  const p = read.programs[0]
  const g = p.grids[0]

  it('keeps the rows exactly as printed', () => {
    expect(g.asPrinted?.columns.map((c) => c.label)).toEqual(['Purchase / R&T', 'Cash-out'])
    expect(g.asPrinted?.rows).toHaveLength(11)
    expect(g.asPrinted?.rows[2]).toEqual({ loanAmountMax: 1500000, ficoMin: 700, values: [80, 75], notes: null })
  })
  it('generates the grid: one row per minimum score, one column per purpose and maximum, blanks where nothing is printed', () => {
    expect(g.rows.map((r) => [r.label, r.ficoMin, r.ficoMax])).toEqual([['720+', 720, 850], ['700+', 700, 850], ['660+', 660, 850], ['640+', 640, 850]])
    expect(g.columns).toHaveLength(12)
    expect(g.columns.slice(0, 3).map((c) => [c.label, c.loanAmountMin, c.loanAmountMax, c.purposes])).toEqual([
      ['Purchase / R&T ≤ $500,000', 0, 500000, ['purchase', 'rate_term']],
      ['Purchase / R&T ≤ $1,000,000', 0, 1000000, ['purchase', 'rate_term']],
      ['Purchase / R&T ≤ $1,500,000', 0, 1500000, ['purchase', 'rate_term']],
    ])
    // Purchase / R&T half of the grid, as the lender's rows give it.
    expect(g.values.map((row) => row.slice(0, 6))).toEqual([
      [null, 80, null, null, null, 70],
      [null, null, 80, 75, 70, 65],
      [null, null, 75, 70, 65, 60],
      [75, null, null, null, null, null],
    ])
    expect(M2.gridSettings(g)).toEqual({ loanAmounts: 'max_tiers', creditScores: 'minimums', blankCells: 'not_specified' })
  })
  it('passes the checks with nothing to fix (blanks under a higher score are not a warning in a row list)', () => {
    expect(repairProgram(p)).toEqual({ program: p, fixes: [] })
    expect(checkProgram(p)).toEqual([])
  })
  it('reads the caps: below a loan amount, and by state and property type', () => {
    expect(p.rules.map((r) => r.appliesWhen)).toEqual([null, { loan_amount_below: 150000 }, { states: ['FL'], property_types: ['condo'] }])
    expect(read.dropped).toEqual(['DSCR rule property type: "castle"'])
  })
  it('saves every cell with the three settings', () => {
    const cells = approvalPayload([{ ...p, include: true, programId: null, mode: 'replace' }])[0].cells
    expect(cells).toHaveLength(48)
    expect(cells.every((c) => c.loan_amount_mode === 'max_tiers' && c.credit_mode === 'minimums' && c.blank_mode === 'not_specified' && c.loan_amount_min === 0 && c.fico_max === 850)).toBe(true)
    expect(cells.filter((c) => c.offered)).toHaveLength(22)
  })
  it('searches the way the lender means it, from the reading to the result', () => {
    const cells = cellsFromProgram(p).map((c, i) => ({ ...c, id: `c${i}`, citizenship: null, maxDti: null, reservesMonths: null }))
    const rules = p.rules.map((r, i) => ({ id: `r${i}`, field: r.field, op: r.op, value: r.value, appliesWhen: r.appliesWhen, severity: r.severity, message: r.message, sourcePage: r.page, sourceQuote: r.quote }))
    const dscr = catalogProgram('Tier Bank', 'DSCR', { family: 'non_qm', docTypes: ['dscr'], cells, rules })
    const max = (fico: number, loanAmount: number, purpose: 'rate_term' | 'cash_out') => evaluateProgram(dscr, lender('Tier Bank'), scenario({ family: 'non_qm', docType: 'dscr', occupancy: 'investment', dscr: 1.1, purpose, fico, loanAmount, value: loanAmount * 2 })).limit?.max
    const both = (fico: number, loan: number) => [max(fico, loan, 'rate_term'), max(fico, loan, 'cash_out')]
    expect(both(720, 400000)).toEqual([80, 80])
    expect(both(700, 750000)).toEqual([80, 75])
    expect(both(660, 1200000)).toEqual([75, 70])
    expect(both(720, 2800000)).toEqual([70, 65])
    expect(both(660, 2800000)).toEqual([60, 60])
    expect(both(700, 140000)).toEqual([70, 70])
    expect(both(640, 600000)).toEqual([undefined, undefined])
  })
  it('an unclear structure has to be confirmed before it can be approved', () => {
    const unclear = (M.normalizeMatrixReading(rowListReading({ ambiguous: true, ambiguous_reason: 'A note says "use the lower of"' })) as M.MatrixReading).programs[0]
    const review = { ...unclear, include: true, programId: null, mode: 'replace' as const }
    expect(M2.approvalBlockers([review])).toEqual(['DSCR: DSCR >= 1.00: confirm how to read this matrix (A note says "use the lower of").'])
    expect(M2.approvalBlockers([{ ...review, grids: review.grids.map((x) => ({ ...x, settingsConfirmed: true })) }])).toEqual([])
  })
  it('two printed rows for the same loan amount and score are flagged as unclear', () => {
    const raw = rowListReading() as { programs: { grids: { row_list: { rows: unknown[] } }[] }[] }
    raw.programs[0].grids[0].row_list.rows.push({ loan_amount_max: 500000, fico_min: 640, values: [70, 65], notes: '' })
    const twice = (M.normalizeMatrixReading(raw) as M.MatrixReading).programs[0].grids[0]
    expect(twice.ambiguous).toBe(true)
    expect(twice.ambiguousReason).toBe('Two rows are printed for the same loan amount and credit score.')
  })
  it('the prompt no longer tells the reader to start a tier one dollar above the one before', () => {
    expect(M.MATRIX_SYSTEM_PROMPT).not.toContain('each column starts one dollar above')
    expect(M.MATRIX_SYSTEM_PROMPT).toContain('Never start a tier one dollar above the tier before')
    expect(M.MATRIX_SYSTEM_PROMPT).toContain('Never turn a row list into credit bands')
  })
  it('a classic grid read with no settings keeps reading as ranges, bands and not offered', () => {
    const classic = (M.normalizeMatrixReading(reading()) as M.MatrixReading).programs[0].grids[0]
    expect(M2.gridSettings(classic)).toEqual({ loanAmounts: 'explicit_ranges', creditScores: 'bands', blankCells: 'not_offered' })
    expect(cellsFromGrid(classic).every((c) => c.loanAmountMode === 'explicit_ranges' && c.creditMode === 'bands' && c.blankMode === 'not_offered')).toBe(true)
  })
})
