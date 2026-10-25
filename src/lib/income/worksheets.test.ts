import { describe, expect, it } from 'vitest'
import type { Employment } from '@/lib/api/urla'
import { property } from '@/lib/mismo/testFixture'
import {
  computeWorksheet,
  currentTargetValue,
  defaultInputs,
  differsFrom1003,
  normalizeInputs,
  pushError,
  pushTarget,
  pushValue,
  rentalNet,
  suggestedLabel,
  type WorksheetData,
} from './worksheets'

const job = (over: Partial<Employment> = {}): Employment => ({
  id: 'job-1', contactId: 'c1', status: 'current', sortOrder: 0, employerName: 'Acme Corp', employerPhone: null,
  addressLine: null, unit: null, city: null, state: null, zip: null, positionTitle: null, startDate: null, endDate: null,
  monthsInLineOfWork: null, employedByParty: false, isSelfEmployed: false, ownership25OrMore: null,
  baseIncome: null, overtimeIncome: null, bonusIncome: null, commissionIncome: null, militaryEntitlements: null,
  otherEmploymentIncome: null, selfEmployedIncome: null, ...over,
})

const rentalHome = property({
  id: 'rental', addressLine: '7 Rental Ave', status: 'owned', monthlyRent: 2000, annualTaxes: 3600, annualInsurance: 1200,
  liens: [{ id: 'l', propertyId: 'rental', position: 'first', lender: null, balance: 150000, noteRate: 5, monthlyPayment: 1100, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null }],
})

describe('worksheet setup', () => {
  it('starts self-employed worksheets at last tax year', () => {
    expect(defaultInputs('schedule_c', new Date('2026-10-25')).recentYear).toBe(2025)
  })

  it('fills in fields missing from saved inputs', () => {
    const inputs = normalizeInputs('rental', { method: 'lease', scheduleE: { rentsReceived: 1000 } })
    expect(inputs.method).toBe('lease')
    expect(inputs.leaseRent).toBeNull()
    expect(inputs.scheduleE).toMatchObject({ rentsReceived: 1000, monthsInService: 12, totalExpenses: null })
    expect(normalizeInputs('salary', 'garbage')).toEqual(defaultInputs('salary'))
  })

  it('suggests a label from the job or property', () => {
    expect(suggestedLabel('salary', job(), null)).toBe('Salary · Acme Corp')
    expect(suggestedLabel('rental', null, rentalHome)).toBe('Rental · 7 Rental Ave')
    expect(suggestedLabel('bank_statement', null, null)).toBe('Bank statement')
  })
})

describe('worksheet results and push targets', () => {
  it('sends salary and hourly to base pay', () => {
    const w: WorksheetData = { kind: 'salary', inputs: { frequency: 'semi_monthly', amount: 3000 } }
    expect(computeWorksheet(w).monthly).toBe(6000)
    expect(pushTarget(w)).toMatchObject({ to: 'employment', field: 'baseIncome' })
    expect(computeWorksheet({ kind: 'hourly', inputs: { rate: 30, hoursPerWeek: 40 } }).monthly).toBe(5200)
  })

  it('sends variable pay to its own field', () => {
    const w: WorksheetData = { kind: 'variable', inputs: { incomeType: 'bonus', ytdAmount: null, ytdMonths: null, priorYear1: 6000, priorYear2: 6000 } }
    expect(computeWorksheet(w).monthly).toBe(500)
    expect(pushTarget(w)).toMatchObject({ field: 'bonusIncome', label: 'Bonus' })
  })

  it('treats an empty tax year as missing', () => {
    const inputs = defaultInputs('schedule_c')
    const w: WorksheetData = { kind: 'schedule_c', inputs: { ...inputs, recent: { ...inputs.recent, netProfit: 60000 } } }
    const r = computeWorksheet(w)
    expect(r.monthly).toBe(5000)
    expect(r.warnings[0]).toMatch(/Only one year/)
    expect(pushTarget(w)).toMatchObject({ field: 'selfEmployedIncome' })
  })

  it('ignores a default ownership % when deciding if an S corp year is empty', () => {
    const inputs = defaultInputs('s_corp')
    const w: WorksheetData = { kind: 's_corp', inputs: { ...inputs, older: { ...inputs.older, ownershipPct: 100 }, recent: { ...inputs.recent, k1OrdinaryIncome: 48000 } } }
    expect(computeWorksheet(w).monthly).toBe(4000)
  })

  it('sends bank statement income to self-employed income', () => {
    const w: WorksheetData = { kind: 'bank_statement', inputs: { ...defaultInputs('bank_statement'), totalDeposits: 240000, excludedDeposits: 0 } }
    expect(computeWorksheet(w).monthly).toBe(10000)
    expect(pushTarget(w)).toMatchObject({ field: 'selfEmployedIncome' })
  })

  it('pushes the gross rent for the lease method and the Schedule E figure otherwise', () => {
    const lease: WorksheetData = { kind: 'rental', inputs: { ...defaultInputs('rental'), method: 'lease', leaseRent: 2400 } }
    expect(computeWorksheet(lease).monthly).toBe(1800)
    expect(pushValue(lease, computeWorksheet(lease))).toBe(2400)
    expect(pushTarget(lease)).toMatchObject({ to: 'property', method: 'lease' })
    const schedE: WorksheetData = { kind: 'rental', inputs: { ...defaultInputs('rental'), scheduleE: { ...defaultInputs('rental').scheduleE, rentsReceived: 24000, totalExpenses: 18000, depreciation: 3000, insurance: 1200, mortgageInterest: 6000, taxes: 3600 } } }
    expect(pushValue(schedE, computeWorksheet(schedE))).toBe(1650)
    expect(pushTarget(schedE)).toMatchObject({ to: 'property', method: 'schedule_e' })
  })
})

describe('comparing with the 1003', () => {
  it('reads the target field', () => {
    expect(currentTargetValue({ to: 'employment', field: 'overtimeIncome', label: '' }, job({ overtimeIncome: 400 }), null)).toBe(400)
    expect(currentTargetValue({ to: 'employment', field: 'baseIncome', label: '' }, null, null)).toBeNull()
    expect(currentTargetValue({ to: 'property', method: 'lease', label: '' }, null, rentalHome)).toBe(2000)
    // The property is still on the lease method, so it has no Schedule E value in use.
    expect(currentTargetValue({ to: 'property', method: 'schedule_e', label: '' }, null, { ...rentalHome, scheduleEMonthlyIncome: 1650 })).toBeNull()
    expect(currentTargetValue({ to: 'property', method: 'schedule_e', label: '' }, null, { ...rentalHome, rentalIncomeMethod: 'schedule_e', scheduleEMonthlyIncome: 1650 })).toBe(1650)
  })

  it('flags a difference, ignoring fractions of a cent', () => {
    expect(differsFrom1003(null, 0)).toBe(true)
    expect(differsFrom1003(5416.67, 5416.67)).toBe(false)
    expect(differsFrom1003(5416.67, 5416.668)).toBe(false)
    expect(differsFrom1003(5000, 5416.67)).toBe(true)
  })

  it('allows a negative push only where the 1003 allows a loss', () => {
    expect(pushError({ to: 'employment', field: 'selfEmployedIncome', label: 'Self-employed income' }, -500)).toBeNull()
    expect(pushError({ to: 'property', method: 'schedule_e', label: 'Schedule E' }, -500)).toBeNull()
    expect(pushError({ to: 'employment', field: 'baseIncome', label: 'Base pay' }, -1)).toMatch(/can't be negative/)
    expect(pushError({ to: 'employment', field: 'baseIncome', label: 'Base pay' }, 0)).toBeNull()
  })
})

describe('rental net', () => {
  it('subtracts the property payment from the worksheet figure', () => {
    const inputs = { ...defaultInputs('rental'), method: 'lease' as const, leaseRent: 2400 }
    const r = rentalNet(inputs, computeWorksheet({ kind: 'rental', inputs }), rentalHome)
    expect(r.net).toBe(300) // 1,800 − 1,500
    expect(r.lines[1].amount).toBe(-1500)
  })

  it('labels a loss', () => {
    const inputs = { ...defaultInputs('rental'), scheduleE: { ...defaultInputs('rental').scheduleE, rentsReceived: 12000, totalExpenses: 12000 } }
    const r = rentalNet(inputs, computeWorksheet({ kind: 'rental', inputs }), rentalHome)
    expect(r.net).toBe(-1500)
    expect(r.lines.at(-1)?.label).toMatch(/loss/)
  })
})
