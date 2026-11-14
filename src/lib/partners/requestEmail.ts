// Title and insurance request emails (Connor, 2026-11-14, from his drafts):
// the file's facts as "Label: value" lines, what to send back, and the loan
// officer's signature. Sent through GoHighLevel to the partner on the file
// only after Connor reviews, edits and clicks Send. Pure, tested.

export type RequestKind = 'title' | 'insurance'

export const REQUEST_LABEL: Record<RequestKind, string> = { title: 'Title request', insurance: 'Insurance request' }

/** What to ask them to send back (editable on the request). */
export const DEFAULT_FORWARD: Record<RequestKind, string> = {
  title: 'Title commitment, tax certificate, survey (if available), closing protection letter and title invoice',
  insurance: 'Evidence of insurance (declarations page) showing the mortgagee clause, and the premium invoice',
}

export interface RequestFacts {
  companyName: string
  companyNmls: string | null
  borrowerName: string
  coBorrowerName: string | null
  /** Any borrowers after the first two. */
  additionalBorrowers: string[]
  propertyAddress: string
  loanNumber: string | null
  loanAmount: number | null
  mortgageeClause: string | null
  purpose: string
  closingDate: string | null
  /** Insurance only: "Impounded" or "Waived". */
  insuranceEscrow: string | null
  lo: { name: string | null; nmls: string | null; phone: string | null; email: string | null }
}

export interface RequestRow {
  key: string
  label: string
  value: string
}

const money = (n: number | null) => (n === null ? '' : `$${Math.round(n).toLocaleString('en-US')}`)
/** "2026-12-10" → "12/10/2026". */
const usDate = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '')

/** The rows in the order of Connor's drafts; each can be edited before sending. */
export function requestRows(kind: RequestKind, f: RequestFacts, forward: string = DEFAULT_FORWARD[kind]): RequestRow[] {
  const rows: RequestRow[] = [
    { key: 'borrower', label: 'Borrower Name', value: f.borrowerName },
    { key: 'coBorrower', label: 'Co-Borrower Name', value: f.coBorrowerName ?? '' },
    { key: 'additional', label: 'Additional Borrower(s)', value: f.additionalBorrowers.join(', ') },
    { key: 'address', label: 'Property Address', value: f.propertyAddress },
    { key: 'loanNumber', label: 'Loan Number', value: f.loanNumber ?? '' },
    { key: 'loanAmount', label: 'Loan Amount', value: money(f.loanAmount) },
    { key: 'clause', label: 'Mortgagee Clause', value: f.mortgageeClause ?? '' },
    { key: 'purpose', label: 'Purpose', value: f.purpose },
    { key: 'closing', label: 'Estimated Closing Date', value: usDate(f.closingDate) },
  ]
  if (kind === 'insurance') rows.push({ key: 'escrow', label: 'Insurance Escrow', value: f.insuranceEscrow ?? '' })
  rows.push({ key: 'forward', label: 'Please forward the following upon completion', value: forward })
  return rows
}

/** "Azle, TX 76020 (TBD)" when there's no street yet; "123 Main St, Azle, TX 76020" once there is. */
export function requestAddress(p: { addressLine: string | null; city: string | null; state: string | null; zip: string | null } | null): string {
  if (!p) return 'TBD'
  const street = p.addressLine?.trim() || ''
  const stateZip = [p.state, p.zip].filter(Boolean).join(' ')
  const rest = [p.city, stateZip].filter(Boolean).join(', ')
  if (!street) return rest ? `${rest} (TBD)` : 'TBD'
  return [street, rest].filter(Boolean).join(', ')
}

export function requestSubject(kind: RequestKind, f: Pick<RequestFacts, 'companyName' | 'borrowerName' | 'propertyAddress'>): string {
  const what = kind === 'title' ? 'Title Request' : 'Insurance Request'
  return `${what} from ${f.companyName}: ${f.borrowerName}, ${f.propertyAddress}`
}

/**
 * The email text (GoHighLevel turns blank lines into paragraphs and single
 * lines into line breaks). A row with several lines (the clause) continues
 * indented under its label.
 */
export function requestBody(kind: RequestKind, rows: RequestRow[], f: Pick<RequestFacts, 'companyName' | 'companyNmls' | 'lo'>): string {
  const heading = `${kind === 'title' ? 'Title' : 'Insurance'} Request from ${f.companyName}`
  const lines = rows.map((r) => {
    const v = r.value.trim()
    if (!v) return `${r.label}:`
    const [first, ...more] = v.split('\n').map((x) => x.trim()).filter(Boolean)
    return [`${r.label}: ${first}`, ...more.map((m) => `    ${m}`)].join('\n')
  })
  const contact = f.lo.email ? `If you have any questions, please email ${f.lo.email} or contact me directly.` : 'If you have any questions, please contact me directly.'
  const signature = [f.lo.name, f.lo.nmls ? `NMLS # ${f.lo.nmls}` : null, [f.lo.phone, f.lo.email].filter(Boolean).join(' | ') || null].filter(Boolean).join('\n')
  const company = [f.companyName, f.companyNmls ? `NMLS # ${f.companyNmls}` : null].filter(Boolean).join('\n')
  return [heading, lines.join('\n'), 'Please confirm receipt of this email once received.', contact, 'Sincerely,', signature, company].filter((p) => p.trim()).join('\n\n')
}
