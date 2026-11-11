// Lender comp plans (build plan Phase 5): what a lender pays the company on a
// loan, and which plan applies. Pure, tested.

export type CompType = 'lender_paid' | 'borrower_paid'

export interface CompFee {
  name: string
  amount: number
  /** true adds to comp (the lender pays it to the broker); false takes it off. */
  adds: boolean
}

export interface CompPlan {
  id: string
  lenderId: string
  compType: CompType
  /** % of the loan amount, e.g. 2.75. */
  compPct: number
  minAmount: number | null
  maxAmount: number | null
  fees: CompFee[]
  effectiveFrom: string
  effectiveTo: string | null
  /** null = every program. */
  programIds: string[] | null
}

const cents = (n: number) => Math.round(n * 100) / 100

/**
 * The lender's comp on a loan: the % of the loan amount, raised to the
 * minimum and held to the maximum, then the flat fees added or taken off.
 * No plan or no loan amount gives null (unknown), never $0.
 */
export function lenderComp(loanAmount: number | null | undefined, plan: Pick<CompPlan, 'compPct' | 'minAmount' | 'maxAmount' | 'fees'> | null | undefined): number | null {
  if (!plan || loanAmount == null || !(loanAmount > 0)) return null
  let comp = (loanAmount * plan.compPct) / 100
  if (plan.minAmount != null) comp = Math.max(comp, plan.minAmount)
  if (plan.maxAmount != null) comp = Math.min(comp, plan.maxAmount)
  for (const f of plan.fees) comp += f.adds ? f.amount : -f.amount
  return cents(comp)
}

/** True when the plan is in effect on the day (YYYY-MM-DD), both ends included. */
export const activeOn = (plan: Pick<CompPlan, 'effectiveFrom' | 'effectiveTo'>, day: string) => plan.effectiveFrom <= day && (plan.effectiveTo == null || day <= plan.effectiveTo)

/**
 * The lender's plan for a loan on a day: one that names the loan's program
 * wins over one for every program. Lender-paid first unless asked for
 * borrower-paid. Null when the lender has no plan then.
 */
export function planFor(plans: CompPlan[], o: { lenderId: string | null; programId: string | null; day: string; compType?: CompType }): CompPlan | null {
  if (!o.lenderId) return null
  const live = plans.filter((p) => p.lenderId === o.lenderId && activeOn(p, o.day))
  const types: CompType[] = o.compType ? [o.compType] : ['lender_paid', 'borrower_paid']
  for (const t of types) {
    const ofType = live.filter((p) => p.compType === t)
    const named = o.programId ? ofType.find((p) => p.programIds?.includes(o.programId!)) : undefined
    const general = ofType.find((p) => p.programIds == null)
    if (named ?? general) return (named ?? general)!
  }
  return null
}

/** Signed-up lenders with no plan in effect today (the Lenders page's "Missing comp plan"). */
export function missingPlan(lenderId: string, plans: CompPlan[], today: string): boolean {
  return !plans.some((p) => p.lenderId === lenderId && activeOn(p, today))
}
