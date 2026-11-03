// Texas title insurance premiums, promulgated by the Texas Department of
// Insurance (TDI). Pure, tested.
//
// Source: TDI "Texas Title Insurance Premium Rates, Rates Effective March 1,
// 2026" (Commissioner's Order No. 2025-9697, the 6.2% cut), downloaded from
// tdi.texas.gov/title/documents/titlerates2026.pdf on 2026-11-03. Simultaneous
// issue: Rate Rule R-5.1/R-5.2 (TDI Basic Manual, effective 11/1/2024).
// Endorsements: R-11 (T-17 PUD $25, T-36 Environmental Protection Lien $25).
// When TDI publishes a new table, replace TDI_TABLE and TDI_OVER_100K.

import { round } from './round'

/** Basic premium for a policy amount "up to and including" each face amount, $25,000–$100,000 in $500 steps. */
const TDI_TABLE: [number, number][] = [
  [25000, 308], [25500, 310], [26000, 314], [26500, 317], [27000, 319], [27500, 322], [28000, 325], [28500, 328], [29000, 333], [29500, 336],
  [30000, 339], [30500, 341], [31000, 345], [31500, 348], [32000, 351], [32500, 355], [33000, 357], [33500, 361], [34000, 364], [34500, 368],
  [35000, 371], [35500, 373], [36000, 376], [36500, 380], [37000, 383], [37500, 386], [38000, 390], [38500, 393], [39000, 395], [39500, 399],
  [40000, 401], [40500, 406], [41000, 408], [41500, 412], [42000, 415], [42500, 418], [43000, 420], [43500, 424], [44000, 428], [44500, 431],
  [45000, 434], [45500, 437], [46000, 440], [46500, 444], [47000, 446], [47500, 448], [48000, 453], [48500, 457], [49000, 460], [49500, 462],
  [50000, 465], [50500, 468], [51000, 470], [51500, 474], [52000, 478], [52500, 482], [53000, 484], [53500, 488], [54000, 491], [54500, 493],
  [55000, 496], [55500, 499], [56000, 504], [56500, 507], [57000, 509], [57500, 513], [58000, 517], [58500, 519], [59000, 522], [59500, 525],
  [60000, 529], [60500, 533], [61000, 536], [61500, 537], [62000, 541], [62500, 545], [63000, 547], [63500, 551], [64000, 554], [64500, 557],
  [65000, 560], [65500, 563], [66000, 567], [66500, 571], [67000, 574], [67500, 575], [68000, 579], [68500, 582], [69000, 585], [69500, 588],
  [70000, 592], [70500, 596], [71000, 599], [71500, 601], [72000, 604], [72500, 608], [73000, 611], [73500, 613], [74000, 617], [74500, 621],
  [75000, 625], [75500, 627], [76000, 629], [76500, 632], [77000, 636], [77500, 639], [78000, 643], [78500, 646], [79000, 650], [79500, 651],
  [80000, 655], [80500, 658], [81000, 662], [81500, 664], [82000, 667], [82500, 672], [83000, 675], [83500, 677], [84000, 680], [84500, 684],
  [85000, 687], [85500, 689], [86000, 692], [86500, 697], [87000, 701], [87500, 703], [88000, 705], [88500, 709], [89000, 713], [89500, 715],
  [90000, 718], [90500, 721], [91000, 725], [91500, 729], [92000, 731], [92500, 734], [93000, 737], [93500, 741], [94000, 742], [94500, 747],
  [95000, 751], [95500, 754], [96000, 755], [96500, 759], [97000, 763], [97500, 766], [98000, 769], [98500, 773], [99000, 776], [99500, 779],
  [100000, 780],
]

/** Over $100,000: subtract the range start, multiply, round to the dollar, add. */
const TDI_OVER_100K: { upTo: number; subtract: number; multiply: number; add: number }[] = [
  { upTo: 1_000_000, subtract: 100_000, multiply: 0.00494, add: 780 },
  { upTo: 5_000_000, subtract: 1_000_000, multiply: 0.00406, add: 5226 },
  { upTo: 15_000_000, subtract: 5_000_000, multiply: 0.00335, add: 21466 },
  { upTo: 25_000_000, subtract: 15_000_000, multiply: 0.00238, add: 54966 },
  { upTo: 50_000_000, subtract: 25_000_000, multiply: 0.00143, add: 78766 },
  { upTo: 100_000_000, subtract: 50_000_000, multiply: 0.00129, add: 114516 },
  { upTo: Infinity, subtract: 100_000_000, multiply: 0.00116, add: 179016 },
]

export const TDI_RATES_EFFECTIVE = '2026-03-01'

/** R-5.1: a loan policy issued with the owner's policy (same land, same date, loan ≤ owner's amount). */
export const SIMULTANEOUS_LOAN_POLICY = 100

/** The TDI basic premium for a policy amount. */
export function texasBasicPremium(amount: number): number {
  if (!(amount > 0)) return 0
  if (amount <= 100_000) return (TDI_TABLE.find(([upTo]) => amount <= upTo) ?? TDI_TABLE[0])[1]
  const b = TDI_OVER_100K.find((x) => amount <= x.upTo)!
  return Math.round((amount - b.subtract) * b.multiply) + b.add
}

/** Owner's policy on a purchase, at the basic rate on the price. */
export const texasOwnerPolicy = (price: number) => texasBasicPremium(price)

/**
 * The lender's policy. With an owner's policy (a purchase): $100 (R-5.1), or
 * when the loan is more than the price, the basic rate on the loan less the
 * basic rate on the price, plus $100 (R-5.2). Without one (a refinance): the
 * basic rate on the loan.
 */
export function texasLenderPolicy(loanAmount: number, ownerPolicyAmount: number | null): number {
  if (!(loanAmount > 0)) return 0
  if (!ownerPolicyAmount) return texasBasicPremium(loanAmount)
  if (loanAmount <= ownerPolicyAmount) return SIMULTANEOUS_LOAN_POLICY
  return round(texasBasicPremium(loanAmount) - texasBasicPremium(ownerPolicyAmount) + SIMULTANEOUS_LOAN_POLICY)
}
