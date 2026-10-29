import { firstPaymentDateFor } from './fees'
import { monthlyPrincipalAndInterest } from './payment'
import { round } from './round'

/**
 * An assumed amortization schedule for a closed loan: the note's amount,
 * rate and term, paid on time with no extra principal. Real balances differ
 * if the borrower paid extra or the loan is an ARM; screens say "estimated".
 */

export interface AmortizationYear {
  /** Calendar year of the payments. */
  year: number
  payments: number
  principal: number
  interest: number
  endingBalance: number
}

export interface Amortization {
  monthlyPayment: number
  /** First payment date used: the file's, else the 1st of the second month after closing. */
  firstPaymentDate: string
  /** True when the first payment date was worked out from the closing date. */
  firstPaymentAssumed: boolean
  payoffDate: string
  totalInterest: number
  years: AmortizationYear[]
}

export interface AmortizationInput {
  loanAmount: number | null
  ratePct: number | null
  termMonths: number | null
  firstPaymentDate: string | null
  closingDate: string | null
}

const addMonths = (isoDate: string, months: number) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10)
}

/** The yearly schedule, or null when amount, rate, term or a date is missing. */
export function amortization(input: AmortizationInput): Amortization | null {
  const { loanAmount, ratePct, termMonths } = input
  if (!loanAmount || loanAmount <= 0 || ratePct === null || ratePct < 0 || !termMonths || termMonths <= 0) return null
  const first = input.firstPaymentDate ?? (input.closingDate ? firstPaymentDateFor(input.closingDate) : null)
  if (!first) return null

  const payment = monthlyPrincipalAndInterest(loanAmount, ratePct, termMonths)
  const r = ratePct / 100 / 12
  const years = new Map<number, AmortizationYear>()
  let balance = loanAmount
  let totalInterest = 0
  for (let n = 0; n < termMonths && balance > 0; n++) {
    const interest = round(balance * r)
    // The last payment clears whatever is left (rounding).
    const principal = n === termMonths - 1 ? balance : Math.min(balance, round(payment - interest))
    balance = round(balance - principal)
    totalInterest = round(totalInterest + interest)
    const year = Number(addMonths(first, n).slice(0, 4))
    const row = years.get(year) ?? { year, payments: 0, principal: 0, interest: 0, endingBalance: 0 }
    row.payments++
    row.principal = round(row.principal + principal)
    row.interest = round(row.interest + interest)
    row.endingBalance = balance
    years.set(year, row)
  }
  return {
    monthlyPayment: payment,
    firstPaymentDate: first,
    firstPaymentAssumed: !input.firstPaymentDate,
    payoffDate: addMonths(first, termMonths - 1),
    totalInterest,
    years: [...years.values()],
  }
}

/** Payments due on or before `today`, counting from the first payment date. */
export function paymentsMade(firstPaymentDate: string, termMonths: number, today: string): number {
  if (today < firstPaymentDate) return 0
  const [fy, fm, fd] = firstPaymentDate.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const months = (ty - fy) * 12 + (tm - fm) + (td >= fd ? 1 : 0)
  return Math.min(Math.max(months, 0), termMonths)
}

export interface MortgageToday {
  schedule: Amortization
  paymentsMade: number
  balance: number
  /** Value less the balance; null with no value. */
  equity: number | null
}

/** Where a closed loan stands today: payments made, estimated balance and equity. */
export function mortgageToday(input: AmortizationInput, today: string, value: number | null): MortgageToday | null {
  const schedule = amortization(input)
  if (!schedule) return null
  const made = paymentsMade(schedule.firstPaymentDate, input.termMonths!, today)
  const balance = balanceAfter(input.loanAmount!, input.ratePct!, input.termMonths!, made)
  return { schedule, paymentsMade: made, balance, equity: value === null ? null : round(value - balance) }
}

/** The estimated balance after a number of on-time payments. */
export function balanceAfter(loanAmount: number, ratePct: number, termMonths: number, payments: number): number {
  const payment = monthlyPrincipalAndInterest(loanAmount, ratePct, termMonths)
  const r = ratePct / 100 / 12
  let balance = loanAmount
  for (let n = 0; n < Math.min(payments, termMonths) && balance > 0; n++) {
    const interest = round(balance * r)
    balance = n === termMonths - 1 ? 0 : round(balance - Math.min(balance, round(payment - interest)))
  }
  return balance
}
