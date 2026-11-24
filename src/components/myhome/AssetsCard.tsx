// Assets on a file's MyHome tab (nurture goals Phase 2, Connor 2026-11-24):
// three columns side by side. Borrower-reported: the accounts each borrower
// keeps in MyHome, with their history (read only; only the borrower changes
// them). Verified: the assets on the 1003. Eligible for qualifying: what Max
// Approval counts from the 1003 (own funds, and cash gifts / grants). The
// reported numbers never count as verified. Math in src/lib/calc/borrowerAssets.ts.
import { useState } from 'react'
import { Card } from '@/components/shared'
import { REPORTED_CATEGORY_LABEL, useReportedAssets, type ReportedAsset } from '@/lib/api/borrowerAssets'
import { useApplication } from '@/lib/api/urla'
import type { LoanProfile } from '@/lib/api/types'
import { assetColumns } from '@/lib/calc/borrowerAssets'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { ASSET_OPTIONS } from '@/lib/urla/options'

export function AssetsCard({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const borrowers = app.data?.borrowers ?? []
  const reported = useReportedAssets(borrowers.map((b) => b.contactId))
  const verified = app.data?.assets ?? []
  const nameOf = (contactId: string) => borrowers.find((b) => b.contactId === contactId)?.person.firstName ?? ''
  const several = borrowers.length > 1
  if (reported.data === null)
    return (
      <Card title="Assets">
        <p className="text-sm text-muted-foreground">Run the My assets script (20270304000000_borrower_assets.sql) to see what borrowers report in MyHome.</p>
      </Card>
    )
  const rows = reported.data ?? []
  const c = assetColumns(rows, verified)
  const typeLabel = (t: string) => ASSET_OPTIONS.find((o) => o.value === t)?.label ?? t
  return (
    <Card title="Assets" description="What they report in MyHome next to the 1003. Reported balances are theirs; only the 1003 counts for qualifying.">
      <div className="grid gap-4 md:grid-cols-3">
        <Column title="Borrower-reported" total={c.reported} note={rows.length ? `${rows.length} account${rows.length === 1 ? '' : 's'} in MyHome` : 'Nothing in My assets yet'}>
          {rows.map((a) => (
            <ReportedRow key={a.id} asset={a} owner={several ? nameOf(a.contactId) : null} />
          ))}
        </Column>
        <Column title="Verified (1003)" total={c.verified} note={verified.length ? `${verified.length} on the 1003` : 'No assets on the 1003'}>
          {verified.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 py-1.5">
              <span className="min-w-0">
                {a.institutionName || typeLabel(a.assetType)}
                <span className="block text-xs text-muted-foreground">
                  {typeLabel(a.assetType)}
                  {a.accountLast4 && ` ··${a.accountLast4}`}
                  {several && ` · ${nameOf(a.contactId)}`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatCurrency(a.amount)}</span>
            </li>
          ))}
        </Column>
        <Column title="Eligible for qualifying" total={c.eligible} note="What Max Approval counts from the 1003">
          <li className="flex justify-between py-1.5">
            <span>Own funds</span>
            <span className="tabular-nums">{formatCurrency(c.eligibleOwn)}</span>
          </li>
          <li className="flex justify-between py-1.5">
            <span>Gifts and grants</span>
            <span className="tabular-nums">{formatCurrency(c.eligibleGift)}</span>
          </li>
          <li className="py-1.5 text-xs text-muted-foreground">Gift of equity and assets used only for depletion income are left out.</li>
        </Column>
      </div>
      {rows.length > 0 && verified.length > 0 && Math.abs(c.gap) >= 1 && (
        <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
          They report {formatCurrency(Math.abs(c.gap))} {c.gap > 0 ? 'more' : 'less'} than the 1003 shows.
          {c.gap > 0 && ' Ask for updated statements before counting it.'}
        </p>
      )}
    </Card>
  )
}

function Column({ title, total, note, children }: { title: string; total: number; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="text-2xl font-bold tabular-nums">{formatCurrency(total)}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
      <ul className="mt-2 divide-y text-sm">{children}</ul>
    </div>
  )
}

function ReportedRow({ asset: a, owner }: { asset: ReportedAsset; owner: string | null }) {
  const [open, setOpen] = useState(false)
  const earlier = a.history.slice(1)
  return (
    <li className="py-1.5">
      <div className="flex justify-between gap-2">
        <span className="min-w-0">
          {a.nickname}
          <span className="block text-xs text-muted-foreground">
            {[a.institution, REPORTED_CATEGORY_LABEL[a.category], owner].filter(Boolean).join(' · ')} · as of {formatIsoDate(a.balanceOn)}
          </span>
        </span>
        <span className="shrink-0 tabular-nums">{formatCurrency(a.balance)}</span>
      </div>
      {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
      {earlier.length > 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-primary">
          {open ? 'Hide history' : `History (${earlier.length})`}
        </button>
      )}
      {open && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {earlier.map((h, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {formatIsoDate(h.on)} · logged {relativeTime(h.loggedAt)}
              </span>
              <span className="tabular-nums">{formatCurrency(h.balance)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
