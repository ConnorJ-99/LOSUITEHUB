// "Proposed updates from [page]" on a file's Overview (Pages, 2026-11-06):
// answers from a page that differ from the file wait here for Accept / Reject.
// Nothing is written until Connor clicks Accept. Hidden when there are none.
import { CheckIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useDecidePageUpdate, useLoanPageSubmissions, type ProposedUpdate } from '@/lib/api/pages'
import { formatPhone } from '@/lib/pipeline/helpers'

const MONEY = new Set(['purchase_price', 'loan_amount', 'cash_out'])
const PURPOSE: Record<string, string> = { purchase: 'Purchase', refinance_rate_term: 'Rate/term refinance', refinance_cash_out: 'Cash-out refinance', heloc: 'HELOC', heloan: 'HELOAN', investment_dscr: 'Investment / DSCR' }
const INCOME: Record<string, string> = { full_doc: 'Full doc (W-2 / tax returns)', bank_statement: 'Bank statement', form_1099: '1099', asset_based: 'Asset based', dscr: 'DSCR' }

export function proposedValue(key: string, v: string | null): string {
  if (v === null || v === '') return 'blank'
  if (MONEY.has(key) && Number.isFinite(Number(v))) return `$${Number(v).toLocaleString('en-US')}`
  if (key === 'phone') return formatPhone(v)
  if (key === 'purpose') return PURPOSE[v] ?? v
  if (key === 'income_doc_type') return INCOME[v] ?? v
  return v
}

export function ProposedUpdatesCard({ loanId }: { loanId: string }) {
  const subs = useLoanPageSubmissions(loanId)
  const decide = useDecidePageUpdate(loanId)
  const pending = (subs.data ?? []).flatMap((s) => s.proposed.filter((p) => p.status === 'pending').map((p) => ({ sub: s, p })))
  if (!pending.length) return null
  const byPage = [...new Set(pending.map((x) => x.sub.pageTitle))]

  const act = (submissionId: string, p: ProposedUpdate, accept: boolean) =>
    decide.mutate(
      { submissionId, key: p.key, accept },
      { onSuccess: () => toast.success(accept ? `${p.label} updated` : `${p.label} left as is`), onError: (e) => toast.error(e.message) },
    )

  return (
    <Card title={`Proposed updates from ${byPage.join(', ')}`} description="Answers from a page that differ from this file. Nothing changes until you accept.">
      <ul className="-my-3 divide-y">
        {pending.map(({ sub, p }) => (
          <li key={`${sub.id}:${p.key}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{p.label}</p>
              <p className="text-muted-foreground">
                <span className="line-through decoration-muted-foreground/50">{proposedValue(p.key, p.current)}</span> → <span className="font-medium text-foreground">{proposedValue(p.key, p.value)}</span>
                {byPage.length > 1 && <span> · {sub.pageTitle}</span>}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" disabled={decide.isPending} onClick={() => act(sub.id, p, true)}>
                <CheckIcon />
                Accept
              </Button>
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => act(sub.id, p, false)}>
                <XIcon />
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
