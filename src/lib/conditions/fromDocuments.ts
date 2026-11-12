// Suggested conditions from analyzed uploads (Stage 3c): out-of-date pay
// stubs and statements, an expired ID, dates that conflict with the 1003, an
// employer that isn't on it, and statement months missing for an account.
// Pure: from the saved analyses (their fields and flags). Each has a stable
// key (code + document), so it's never suggested twice and stops showing
// once added or dismissed. Connor checks which to post.

import { statementGaps, type DocFlag, type ReadFieldKey, type ReadField } from '../../../supabase/functions/assistant/documentRead'
import type { Suggestion } from './suggest'

export interface AnalyzedDoc {
  documentId: string
  contactId: string | null
  fileName: string
  /** The AI's suggested type (null before it has run). */
  kind: string | null
  fields: Partial<Record<ReadFieldKey, ReadField>>
  flags: DocFlag[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
const text = (f: ReadField | undefined) => (f && typeof f.value === 'string' ? f.value : null)

const base = (d: AnalyzedDoc, code: string, body: string, why: string, over: Partial<Suggestion> = {}): Suggestion => ({
  key: `doc_${code}:${d.documentId}`,
  ruleKey: `doc_${code}`,
  contactId: d.contactId,
  body,
  why,
  source: { kind: 'ai', label: `Upload: ${d.fileName}`, citation: null },
  party: 'borrower',
  stage: 'processing',
  kind: 'other',
  request: null,
  requestKey: `doc_${code}_${d.documentId.slice(0, 8)}`,
  ...over,
})

export function documentSuggestions(docs: AnalyzedDoc[]): Suggestion[] {
  const out: Suggestion[] = []
  for (const d of docs) {
    const employer = text(d.fields.employer_name)
    const account = [text(d.fields.institution), d.fields.account_last4 ? `••${d.fields.account_last4.value}` : null].filter(Boolean).join(' ')
    for (const f of d.flags) {
      if (f.code === 'old_paystub') out.push(base(d, f.code, `Updated pay stub covering the last 30 days${employer ? `: ${employer}` : ''}`, f.text, { kind: 'paystub' }))
      if (f.code === 'statement_old') out.push(base(d, f.code, `Most recent statement${account ? `: ${account}` : ''}`, f.text, { kind: 'bank_statement' }))
      if (f.code === 'id_expired') out.push(base(d, f.code, 'Unexpired photo ID', f.text, { kind: 'photo_id' }))
      if (f.code === 'dates_conflict') out.push(base(d, f.code, `Letter of explanation: ${f.text}`, 'The upload and the 1003 disagree', { kind: 'explanation_letter' }))
      if (f.code === 'employer_not_on_1003') out.push(base(d, f.code, `Confirm employment history: ${f.employer ?? 'an employer'} is on an upload but not on the 1003`, f.text, { party: 'processor_lo', stage: 'application' }))
    }
  }
  // Statement months missing, per account (statements read as the same institution + last 4).
  const byAccount = new Map<string, AnalyzedDoc[]>()
  for (const d of docs.filter((x) => (x.kind === 'bank_statement' || x.kind === 'investment_statement') && x.fields.account_last4)) {
    const k = `${d.contactId ?? ''}:${d.fields.account_last4!.value}`
    byAccount.set(k, [...(byAccount.get(k) ?? []), d])
  }
  for (const [k, list] of byAccount) {
    const periods = list.flatMap((d) => (text(d.fields.statement_period_start) && text(d.fields.statement_period_end) ? [{ start: text(d.fields.statement_period_start)!, end: text(d.fields.statement_period_end)! }] : []))
    const first = list[0]
    const name = [text(first.fields.institution), `••${first.fields.account_last4!.value}`].filter(Boolean).join(' ')
    for (const g of statementGaps(periods)) {
      out.push({
        ...base(first, 'statement_gap', `Missing statement between ${monthYear(g.from)} and ${monthYear(g.to)}: ${name}`, `The uploaded statements skip from ${monthYear(g.from)} to ${monthYear(g.to)}`, { kind: 'bank_statement' }),
        key: `doc_statement_gap:${k}:${g.from}`,
        requestKey: `doc_statement_gap_${first.fields.account_last4!.value}_${g.from}`,
      })
    }
  }
  return out
}
