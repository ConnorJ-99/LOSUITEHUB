import { describe, expect, it } from 'vitest'
import type { NoteItem } from '../../../supabase/functions/assistant/callNotes'
import type { Property } from '@/lib/api/types'
import type { PrequalDraft } from './draft'
import { applyToDraft, buildNoteReview, defaultNoteDecisions, noteRecord, savedNow, type NoteReviewFile } from './noteReview'

const draft: PrequalDraft = {
  loan: { mortgageType: 'conventional', purchasePrice: null, downPaymentMode: 'percent', downPaymentPct: 5, downPaymentAmount: null, loanAmount: null, noteRate: null, termMonths: 360, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3600, estimatedMonthlyHoa: null, miRatePct: null, upfrontFeePct: null, maxDtiPct: 45 },
  borrowers: [{ contactId: 'c1', firstName: 'Marcus', role: 'primary', creditScore: null, jobs: [{ key: 'job-1', id: 'j1', employerName: 'Reyes Landscaping LLC', selfEmployed: true, monthly: 8000, otherPay: 0, startDate: null }], otherIncomes: [] }],
  debts: [{ key: 'debt-1', id: 'd1', contactId: 'c1', liabilityType: 'installment', creditorName: 'Ford Credit', monthlyPayment: 550, toBePaidOff: false, unpaidBalance: 20000 }],
  assets: [],
  properties: [{ key: 'home-1', id: 'p1', addressLine: '1200 Elm St', plan: 'keep', monthlyRent: null, estimatedValue: 450000, sellingCostPct: 8, saved: {} as Property }],
}
const file: NoteReviewFile = { isPurchase: true, details: { incomeDocType: null, timeline: null }, creditEvents: [], ownedPast3Years: { c1: null } }

let n = 0
const item = (i: Record<string, unknown>, confidence: 'high' | 'medium' | 'low' = 'high') => ({ id: `i${++n}`, quote: 'q', confidence, quoteFound: true, ...i }) as NoteItem

const items = [
  item({ kind: 'credit_score', value: 652, borrower: null }),
  item({ kind: 'credit_score', value: 700, borrower: 'Maria' }),
  item({ kind: 'job', employer: 'landscaping', selfEmployed: true, monthly: 9800, startDate: null, years: 6, borrower: null }, 'medium'),
  item({ kind: 'debt', debtType: 'installment', creditor: 'Ford', monthlyPayment: 612, balance: null, payOff: false, borrower: null }),
  item({ kind: 'debt', debtType: 'revolving', creditor: 'Chase card', monthlyPayment: 85, balance: 2400, payOff: true, borrower: null }),
  item({ kind: 'savings', assetType: 'checking', institution: 'Chase', amount: 30000, borrower: null }),
  item({ kind: 'home', address: 'current house', value: 467000, owed: 282000, plan: null, monthlyRent: null }),
  item({ kind: 'credit_event', eventType: 'late_payment', date: '2024-01-01', daysLate: 30, isMortgage: false, borrower: null }, 'low'),
  item({ kind: 'doc_type', value: 'bank_statement' }),
  item({ kind: 'purchase_price', value: 400000 }),
]

describe('call note review', () => {
  const rows = buildNoteReview(items, draft, file, {})
  const row = (id: string) => rows.find((r) => r.item.id === id)!

  it('matches each item to the right person, job, debt and home', () => {
    expect(row('i1')).toMatchObject({ person: 'Marcus', destination: 'form', currentLabel: '—', proposedLabel: '652' })
    expect(row('i2')).toMatchObject({ destination: 'not_applied', note: "Maria isn't on this file. Add them as a co-borrower first, then read the note again." })
    expect(row('i3')).toMatchObject({ label: 'Job (update)', matchKey: 'job-1', note: 'Notes say 6 years; add the start date (pencil) so readiness can count it.' })
    expect(row('i4')).toMatchObject({ label: 'Debt (update)', matchKey: 'debt-1', currentLabel: 'Ford Credit: $550/mo' })
    expect(row('i5')).toMatchObject({ label: 'Debt (new)', proposedLabel: 'Chase card: $85/mo, owes $2,400, paid off at closing' })
    expect(row('i7')).toMatchObject({ destination: 'form', matchKey: 'home-1', note: 'Notes say they owe $282,000; check the mortgage on the Properties tab.' })
    expect(row('i8')).toMatchObject({ destination: 'saved', proposedLabel: 'Late payment (30 days), Jan 1, 2024' })
    expect(row('i9')).toMatchObject({ destination: 'saved', proposedLabel: 'Bank statements' })
  })

  it('starts with changes picked, except low confidence and items that cannot be used', () => {
    const d = defaultNoteDecisions(items, draft, file)
    expect(Object.entries(d).filter(([, v]) => v.use).map(([k]) => k)).toEqual(['i1', 'i3', 'i4', 'i5', 'i6', 'i7', 'i9', 'i10'])
  })

  it('fills the form with the picked items, including edits', () => {
    const d = { ...defaultNoteDecisions(items, draft, file), i3: { use: true, edited: { startDate: '2020-05-01' } }, i8: { use: true } }
    const r = buildNoteReview(items, draft, file, d)
    const next = applyToDraft(draft, r, d)
    expect(next.borrowers[0].creditScore).toBe(652)
    expect(next.borrowers[0].jobs).toEqual([{ key: 'job-1', id: 'j1', employerName: 'Reyes Landscaping LLC', selfEmployed: true, monthly: 9800, otherPay: 0, startDate: '2020-05-01' }])
    expect(next.debts.map((x) => [x.creditorName, x.monthlyPayment, x.unpaidBalance, x.toBePaidOff])).toEqual([
      ['Ford Credit', 612, 20000, false],
      ['Chase card', 85, 2400, true],
    ])
    expect(next.assets).toEqual([{ key: 'note-i6', id: null, contactId: 'c1', assetType: 'checking', institutionName: 'Chase', amount: 30000, useAs: 'down_payment' }])
    expect(next.properties[0]).toMatchObject({ estimatedValue: 467000, plan: 'keep' })
    expect(next.loan.purchasePrice).toBe(400000)
    expect(draft.borrowers[0].creditScore).toBeNull() // the original is untouched

    expect(savedNow(r, d)).toEqual({ incomeDocType: 'bank_statement', creditEvents: [{ contactId: 'c1', eventType: 'late_payment', eventDate: '2024-01-01', daysLate: 30, isMortgage: false }], ownedPast3Years: [] })
    const record = noteRecord(r, d)
    expect(record.outcome).toBe('edited')
    expect(record.items.find((x) => x.id === 'i2')?.decision).toBe('skipped')
  })

  it('knows what is already on file', () => {
    const onFile: NoteReviewFile = { ...file, details: { incomeDocType: 'bank_statement', timeline: null }, creditEvents: [{ id: 'e', contactId: 'c1', eventType: 'late_payment', eventDate: '2024-01-01', daysLate: 30, isMortgage: false, amount: null, notes: null }] }
    const r = buildNoteReview(items, draft, onFile, {})
    expect(r.find((x) => x.item.id === 'i8')).toMatchObject({ same: true, currentLabel: 'Already in credit history' })
    expect(r.find((x) => x.item.id === 'i9')?.same).toBe(true)
  })

  it('refinance files skip the purchase price; unknown homes wait for the Properties tab', () => {
    const r = buildNoteReview([...items, item({ kind: 'home', address: '55 Oak Ave', value: 300000, owed: null, plan: 'rent', monthlyRent: 2100 })], draft, { ...file, isPurchase: false }, {})
    expect(r.find((x) => x.item.kind === 'purchase_price')).toMatchObject({ destination: 'not_applied', note: 'This file is a refinance.' })
    expect(r.at(-1)).toMatchObject({ destination: 'not_applied', note: 'Add 55 Oak Ave on the Properties tab first.' })
  })
})

describe('nameMatch', () => {
  it('matches on a shared meaningful word, not on filler', async () => {
    const { nameMatch } = await import('./noteReview')
    expect(nameMatch('landscaping business', 'Reyes Landscaping LLC')).toBe(true)
    expect(nameMatch('Ford truck', 'Ford Credit')).toBe(true)
    expect(nameMatch('Chase card', 'Chase')).toBe(true)
    expect(nameMatch('Toyota car loan', 'Ford Credit')).toBe(false)
    expect(nameMatch('credit card', 'Ford Credit')).toBe(false)
    expect(nameMatch('', 'Ford')).toBe(false)
  })
})
