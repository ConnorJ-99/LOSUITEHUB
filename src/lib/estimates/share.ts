// Sharing estimates by link (build plan Phase 7; plan
// docs/plans/estimate-share-links.md). The frozen copy the borrower sees is
// built here from the same worksheet the estimate PDF prints, so the page and
// the PDF always agree. Options are "Option 1, 2…" with the product, never the
// lender. APR is left out until the APR estimate is in the app.

import type { FeeWorksheet } from '@/lib/documents/feeWorksheet'
import type { ScenarioFigures } from '@/lib/pricing/scenario'
import type { ShareOption, ShareSnapshot } from '../../../supabase/functions/estimate-view/rules'

export const MAX_SHARED = 5
export const DEFAULT_SHARE_DAYS = 7

export interface ShareSource {
  estimateId: string
  /** The product ("FHA 30-year fixed"), never the lender. */
  program: string
  ratePct: number | null
  pointsPct: number
  lenderCredit: number
  loanAmount: number
  purchasePrice: number | null
  worksheet: FeeWorksheet
  figures: ScenarioFigures
  pdfDocumentId: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function shareOption(s: ShareSource, index: number): ShareOption {
  const w = s.worksheet
  return {
    estimateId: s.estimateId,
    name: `Option ${index + 1}`,
    program: s.program,
    ratePct: s.ratePct,
    aprPct: null,
    pointsPct: s.pointsPct,
    lenderCredit: round2(s.lenderCredit),
    loanAmount: round2(s.figures.totalLoanAmount || s.loanAmount),
    downPayment: s.purchasePrice ? Math.max(0, round2(s.purchasePrice - s.loanAmount)) : 0,
    principalAndInterest: round2(s.figures.payment.principalAndInterest),
    payment: { lines: w.payment.lines.map((l) => ({ label: l.label, amount: l.amount })), total: w.payment.total },
    cash: { title: w.cash.title, lines: w.cash.lines.map((l) => ({ label: l.label, amount: l.amount, ...(l.negative ? { minus: true } : {}) })), total: w.cash.total },
    sections: [...w.loanCosts, ...w.otherCosts]
      .filter((x) => x.rows.length > 0)
      .map((x) => ({ letter: x.letter, title: x.title, total: x.total, rows: x.rows.filter((r) => !r.note).map((r) => ({ label: r.label, amount: r.amount })) })),
    pdfDocumentId: s.pdfDocumentId,
  }
}

/** The frozen copy: 1 to 5 options in the order they were checked. */
export function shareSnapshot(sources: ShareSource[], asOf: string): ShareSnapshot {
  if (sources.length < 1 || sources.length > MAX_SHARED) throw new Error(`Pick 1 to ${MAX_SHARED} estimates to share.`)
  return { asOf, options: sources.map(shareOption) }
}

export const shareUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/e/${token}`

/** The default message (text or email body). {link} is replaced by the link. */
export function shareMessage(firstName: string, loName: string, count: number): string {
  const what = count === 1 ? 'the loan option' : 'the loan options'
  return `Hi ${firstName}, here are ${what} we went over: {link} You'll confirm your email to open them. Rates are as of today and can change. - ${loName}`
}

export const fillLink = (message: string, url: string) => (message.includes('{link}') ? message.replaceAll('{link}', url) : `${message.trim()} ${url}`)

/** Days from today, kept between 1 and 60 (the database's limit). */
export function shareExpiry(days: number, now: Date = new Date()): string {
  const d = Math.min(60, Math.max(1, Math.round(days || DEFAULT_SHARE_DAYS)))
  return new Date(now.getTime() + d * 86_400_000).toISOString()
}

export type ShareStatus = 'revoked' | 'expired' | 'picked' | 'opened' | 'not_opened'

export function shareStatus(s: { revokedAt: string | null; expiresAt: string; pickedEstimateId: string | null; firstOpenedAt: string | null }, now: Date = new Date()): ShareStatus {
  if (s.revokedAt) return 'revoked'
  if (Date.parse(s.expiresAt) <= now.getTime()) return 'expired'
  if (s.pickedEstimateId) return 'picked'
  return s.firstOpenedAt ? 'opened' : 'not_opened'
}
