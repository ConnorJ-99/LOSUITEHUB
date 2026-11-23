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
  /** How many payments until it is paid off (the term, or fewer with extra payments). */
  months: number
  totalInterest: number
  years: AmortizationYear[]
  /** The balance after each payment (index 0 = after the first). */
  balances: number[]
}

/**
 * Extra principal (MyHome, Connor 2026-11-23): a monthly extra from a date
 * on, and one-time amounts, each added to the first scheduled payment on or
 * after its date. The regular payment stays the same; the loan pays off sooner.
 */
export interface ExtraPayments {
  monthly?: { amount: number; from: string } | null
  oneTime?: { date: string; amount: number }[]
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
export function amortization(input: AmortizationInput, extra?: ExtraPayments): Amortization | null {
  const { loanAmount, ratePct, termMonths } = input
  if (!loanAmount || loanAmount <= 0 || ratePct === null || ratePct < 0 || !termMonths || termMonths <= 0) return null
  const first = input.firstPaymentDate ?? (input.closingDate ? firstPaymentDateFor(input.closingDate) : null)
  if (!first) return null

  const payment = monthlyPrincipalAndInterest(loanAmount, ratePct, termMonths)
  const r = ratePct / 100 / 12
  const years = new Map<number, AmortizationYear>()
  let balance = loanAmount
  let totalInterest = 0
  let months = 0
  const balances: number[] = []
  // One-time amounts by the payment they land on (the first one on or after their date).
  const lump = new Map<number, number>()
  for (const o of extra?.oneTime ?? []) {
    if (!(o.amount > 0)) continue
    let n = 0
    while (n < termMonths - 1 && addMonths(first, n) < o.date) n++
    lump.set(n, round((lump.get(n) ?? 0) + o.amount))
  }
  const monthly = extra?.monthly && extra.monthly.amount > 0 ? extra.monthly : null
  for (let n = 0; n < termMonths && balance > 0; n++) {
    const date = addMonths(first, n)
    const interest = round(balance * r)
    const more = round((monthly && date >= monthly.from ? monthly.amount : 0) + (lump.get(n) ?? 0))
    // The last payment clears whatever is left (rounding); extra principal never goes past the balance.
    const principal = n === termMonths - 1 ? balance : Math.min(balance, round(payment - interest + more))
    balance = round(balance - principal)
    totalInterest = round(totalInterest + interest)
    months = n + 1
    balances.push(balance)
    const year = Number(date.slice(0, 4))
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
    payoffDate: addMonths(first, months - 1),
    months,
    totalInterest,
    years: [...years.values()],
    balances,
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
export function mortgageToday(input: AmortizationInput, today: string, value: number | null, extra?: ExtraPayments): MortgageToday | null {
  const schedule = amortization(input, extra)
  if (!schedule) return null
  const made = Math.min(paymentsMade(schedule.firstPaymentDate, input.termMonths!, today), schedule.months)
  // With extra payments the schedule's own balances; without, the plain on-time balance.
  const balance = extra ? (made ? (schedule.balances[made - 1] ?? 0) : input.loanAmount!) : balanceAfter(input.loanAmount!, input.ratePct!, input.termMonths!, made)
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

/** What extra payments do: the schedule with them, the interest saved and how much sooner it's paid off. */
export function extraPaymentEffect(input: AmortizationInput, extra: ExtraPayments): { base: Amortization; withExtra: Amortization; interestSaved: number; monthsSaved: number } | null {
  const base = amortization(input)
  const withExtra = amortization(input, extra)
  if (!base || !withExtra) return null
  return { base, withExtra, interestSaved: round(base.totalInterest - withExtra.totalInterest), monthsSaved: base.months - withExtra.months }
}


/**
 * Extra payments a borrower logged (MyHome, Connor 2026-11-23) as one-time
 * amounts on the schedule: each counts on the most recent due date on or
 * before the day it was paid (the first payment when paid before it), so the
 * balance drops right away rather than at the next payment.
 */
export function loggedExtras(firstPaymentDate: string, paid: readonly { paidOn: string; amount: number }[]): ExtraPayments {
  const [fy, fm, fd] = firstPaymentDate.split('-').map(Number)
  return {
    oneTime: paid
      .filter((p) => p.amount > 0)
      .map((p) => {
        if (p.paidOn <= firstPaymentDate) return { date: firstPaymentDate, amount: p.amount }
        const [y, m, d] = p.paidOn.split('-').map(Number)
        const back = (y - fy) * 12 + (m - fm) - (d < fd ? 1 : 0)
        return { date: addMonths(firstPaymentDate, back), amount: p.amount }
      }),
  }
}
