import type { LoanPurposeKind } from './loan'

// Texas Constitution Art. XVI §50(a)(6) home equity rules, as flags for the LO.
// These are reminders, not legal advice: the lender's compliance review rules.

export const TEXAS_HOME_EQUITY_MAX_CLTV = 80
export const TEXAS_NOTICE_DAYS = 12
export const TEXAS_SEASONING_DAYS = 365

export type TexasFlagSeverity = 'error' | 'warning' | 'info'

export interface TexasFlag {
  code: 'cltv_cap' | 'cltv_unknown' | 'seasoning' | 'notice'
  severity: TexasFlagSeverity
  message: string
}

export interface TexasCheckInput {
  purpose: LoanPurposeKind
  propertyState: string | null
  isHomestead: boolean
  cltv: number | null
  /** Closing dates (YYYY-MM-DD) of earlier Texas cash-out loans on this home. */
  priorCashOutDates: string[]
  /** Planned closing date (YYYY-MM-DD), if known. */
  closingDate: string | null
  /** Today's date (YYYY-MM-DD); passed in so results are testable. */
  today: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const toUtc = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`)
const addDays = (isoDate: string, days: number) => new Date(toUtc(isoDate) + days * DAY_MS).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS)

const usDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-')
  return `${Number(m)}/${Number(d)}/${y}`
}

/** True when the loan is a Texas §50(a)(6) home equity loan (cash-out or 2nd lien on a TX homestead). */
export function isTexasHomeEquity(input: Pick<TexasCheckInput, 'purpose' | 'propertyState' | 'isHomestead'>): boolean {
  const equityPurpose = input.purpose === 'refinance_cash_out' || input.purpose === 'heloc' || input.purpose === 'heloan'
  return equityPurpose && input.isHomestead && (input.propertyState ?? '').trim().toUpperCase() === 'TX'
}

/** Flags for the Texas home equity rules: 80% CLTV cap, 1-year seasoning, 12-day notice. */
export function texasHomeEquityFlags(input: TexasCheckInput): TexasFlag[] {
  if (!isTexasHomeEquity(input)) return []
  const flags: TexasFlag[] = []

  if (input.cltv === null) {
    flags.push({ code: 'cltv_unknown', severity: 'warning', message: 'Add the home value and liens to check the 80% CLTV limit.' })
  } else if (input.cltv > TEXAS_HOME_EQUITY_MAX_CLTV) {
    flags.push({
      code: 'cltv_cap',
      severity: 'error',
      message: `Texas home equity max CLTV is ${TEXAS_HOME_EQUITY_MAX_CLTV}%; this scenario is ${input.cltv}%.`,
    })
  }

  const closeOrToday = input.closingDate ?? input.today
  const latestPrior = [...input.priorCashOutDates].sort().at(-1)
  if (latestPrior) {
    const seasonedOn = addDays(latestPrior, TEXAS_SEASONING_DAYS)
    if (closeOrToday < seasonedOn) {
      flags.push({
        code: 'seasoning',
        severity: 'error',
        message: `A prior Texas cash-out loan closed ${usDate(latestPrior)}. A new one can't close before ${usDate(seasonedOn)}.`,
      })
    }
  }

  if (input.closingDate) {
    const daysOut = daysBetween(input.today, input.closingDate)
    const noticeBy = addDays(input.closingDate, -TEXAS_NOTICE_DAYS)
    flags.push({
      code: 'notice',
      severity: daysOut < TEXAS_NOTICE_DAYS ? 'warning' : 'info',
      message:
        daysOut < TEXAS_NOTICE_DAYS
          ? `Closing is ${daysOut} days away. The 12-day Texas home equity notice must have gone out by ${usDate(noticeBy)}.`
          : `Send the 12-day Texas home equity notice by ${usDate(noticeBy)}.`,
    })
  } else {
    flags.push({
      code: 'notice',
      severity: 'info',
      message: 'The borrower must receive the Texas home equity notice at least 12 days before closing.',
    })
  }

  return flags
}
