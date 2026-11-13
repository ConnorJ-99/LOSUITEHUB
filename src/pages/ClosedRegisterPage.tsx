import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, DateInput, EmptyState, PageHeader, Select } from '@/components/shared'
import { OCCUPANCY_OPTIONS } from '@/components/profile/options'
import { AriveLink } from '@/components/loanfile/AriveLink'
import { useCompPlans } from '@/lib/api/compPlans'
import { useLenders } from '@/lib/api/lenders'
import { useRegisterLoans } from '@/lib/api/register'
import { useAuth } from '@/lib/auth/context'
import { REVIEW_STATUS_LABEL } from '@/lib/closed/reviews'
import { COMMISSION_LABEL, commissionStatus, filterRegister, REGISTER_COLUMNS, registerCells, registerRow, registerTotals, thisMonth, type CommissionFilter, type RegisterFilters } from '@/lib/closed/register'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { downloadText } from '@/lib/download'
import { formatCurrency, formatPercent } from '@/lib/format'
import { toCsv } from '@/lib/import/csv'
import { purposeLabel } from '@/lib/pipeline/stages'

const ALL = 'all'
const occupancy = (o: string | null) => OCCUPANCY_OPTIONS.find((x) => x.value === o)?.label ?? o ?? ''
const money = (v: number | null) => (v == null ? '—' : formatCurrency(v))

/**
 * The closed loan register: one row per closed loan, by production date
 * (funding, else closing), with comp from each loan's snapshot. Admins see
 * every loan; a loan officer sees their own. Read only: rows open the file.
 */
export function ClosedRegisterPage() {
  const navigate = useNavigate()
  const { state } = useAuth()
  const seesAll = state.status === 'signedIn' && state.user.role === 'admin'
  const lenders = useLenders()
  const plans = useCompPlans()
  const loans = useRegisterLoans(lenders.data?.map((l) => ({ id: l.id, name: l.name })))
  const today = todayIso()
  const [f, setF] = useState<RegisterFilters>({ ...thisMonth(today), loId: null, leadSource: null, commission: null })

  const all = useMemo(() => (loans.data ?? []).map((l) => registerRow(l, plans.data ?? [])), [loans.data, plans.data])
  const rows = useMemo(() => filterRegister(all, f), [all, f])
  const totals = registerTotals(rows)
  const los = [...new Map(all.filter((r) => r.loId).map((r) => [r.loId!, r.loName ?? 'Unknown'])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const flagged = rows.filter((r) => r.flags.length).length

  const exportCsv = () =>
    downloadText(
      `closed-register-${f.from ?? 'all'}-to-${f.to ?? 'all'}.csv`,
      toCsv([[...REGISTER_COLUMNS], ...rows.map((r) => registerCells(r, { purpose: (p) => purposeLabel(p as never), occupancy })), ['Totals', '', '', `${totals.count} loans`, '', '', '', '', '', '', totals.volume, '', '', '', '', totals.gross, totals.loComp, totals.net, '', '', '', '']]),
      'text/csv',
    )

  return (
    <>
      <PageHeader
        eyebrow="Production"
        title="Closed loan register"
        description={`Operational register, Arive remains the loan record of record. ${seesAll ? 'Every closed loan.' : 'Your closed loans.'} Counted on the funding date (else the closing date).`}
        action={
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <DownloadIcon />
            Export CSV
          </Button>
        }
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <DateInput label="From (production date)" value={f.from} onChange={(from) => setF({ ...f, from })} />
          <DateInput label="To" value={f.to} onChange={(to) => setF({ ...f, to })} />
          <Select label="Loan officer" value={f.loId ?? ALL} options={[{ value: ALL, label: 'Everyone' }, ...los.map(([value, label]) => ({ value, label }))]} onChange={(v) => setF({ ...f, loId: v === ALL ? null : v })} />
          <Select label="Lead source" value={f.leadSource ?? ALL} options={[{ value: ALL, label: 'All' }, { value: 'company', label: 'Company-generated' }, { value: 'self', label: 'Self-generated' }]} onChange={(v) => setF({ ...f, leadSource: v === ALL ? null : (v as 'company' | 'self') })} />
          <Select label="Commission" value={f.commission ?? ALL} options={[{ value: ALL, label: 'All' }, ...(Object.keys(COMMISSION_LABEL) as CommissionFilter[]).map((value) => ({ value, label: COMMISSION_LABEL[value] }))]} onChange={(v) => setF({ ...f, commission: v === ALL ? null : (v as CommissionFilter) })} />
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setF({ ...f, ...thisMonth(today) })}>
              This month
            </Button>
            <Button size="sm" variant="outline" onClick={() => setF({ ...f, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` })}>
              This year
            </Button>
          </div>
        </div>
      </Card>

      {loans.isLoading || lenders.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : loans.isError ? (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load the register" description={`${loans.error.message} (The comp settings database script may not have run yet.)`} />
        </Card>
      ) : (
        <Card>
          {flagged > 0 && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{flagged} {flagged === 1 ? 'loan needs' : 'loans need'} cleaning up (no funding date, no revenue, or revenue that doesn't match the lender's comp plan).</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
                  <th>Production</th>
                  <th>Closed · funded</th>
                  <th>Borrower · property</th>
                  <th>LO</th>
                  <th>Lender · program</th>
                  <th>Loan</th>
                  <th className="text-right!">Amount</th>
                  <th>Rate · term</th>
                  <th>Arive #</th>
                  <th>Source</th>
                  <th className="text-right!">Gross</th>
                  <th className="text-right!">LO comp</th>
                  <th className="text-right!">Net</th>
                  <th>Commission</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-10 text-center text-sm text-muted-foreground">
                      No closed loans in these dates.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer align-top hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2" onClick={() => navigate(`/loans/${r.id}`)}>
                    <td className="whitespace-nowrap tabular-nums">
                      {r.productionDate ? formatIsoDate(r.productionDate) : '—'}
                      {r.flags.map((fl) => (
                        <p key={fl} className="text-[11px] whitespace-normal text-amber-700">{fl}</p>
                      ))}
                    </td>
                    <td className="whitespace-nowrap text-xs tabular-nums">
                      {r.closingDate ? formatIsoDate(r.closingDate) : '—'}
                      <br />
                      {r.fundingDate ? formatIsoDate(r.fundingDate) : '—'}
                    </td>
                    <td>
                      <p className="font-medium">{r.borrower}</p>
                      <p className="text-xs text-muted-foreground">{r.property ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap">{r.loName ?? '—'}</td>
                    <td>
                      <p>{r.lender ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{r.program ?? ''}</p>
                    </td>
                    <td className="text-xs">
                      {purposeLabel(r.purpose as never)}
                      <br />
                      {occupancy(r.occupancy)}
                    </td>
                    <td className="text-right tabular-nums">{money(r.loanAmount)}</td>
                    <td className="whitespace-nowrap text-xs tabular-nums">{[r.rate == null ? null : formatPercent(r.rate, 3), r.termMonths ? `${r.termMonths / 12} yr` : null].filter(Boolean).join(' · ') || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>{r.ariveLoanNumber ? <AriveLink number={r.ariveLoanNumber} /> : '—'}</td>
                    <td className="text-xs">{r.leadSourceType === 'company' ? 'Company' : r.leadSourceType === 'self' ? 'Self' : '—'}</td>
                    <td className="text-right tabular-nums">{r.gross == null ? <span className="text-amber-700">Needs revenue</span> : money(r.gross)}</td>
                    <td className="text-right tabular-nums">{money(r.loComp)}</td>
                    <td className="text-right tabular-nums">{money(r.net)}</td>
                    <td className={`text-xs whitespace-nowrap ${commissionStatus(r) === 'unconfirmed' ? 'text-muted-foreground' : 'text-nurture'}`}>{r.compPaidOn ? `Paid ${formatIsoDate(r.compPaidOn)}` : COMMISSION_LABEL[commissionStatus(r)]}</td>
                    <td className="text-xs whitespace-nowrap">{r.reviewStatus ? REVIEW_STATUS_LABEL[r.reviewStatus] : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t-2 font-semibold">
                  <tr className="[&>td]:px-3 [&>td]:py-2">
                    <td colSpan={6}>
                      Totals · {totals.count} {totals.count === 1 ? 'loan' : 'loans'}
                      {totals.missingRevenue > 0 && <span className="ml-2 text-xs font-normal text-amber-700">({totals.missingRevenue} without revenue)</span>}
                    </td>
                    <td className="text-right tabular-nums">{money(totals.volume)}</td>
                    <td colSpan={3} />
                    <td className="text-right tabular-nums">{money(totals.gross)}</td>
                    <td className="text-right tabular-nums">{money(totals.loComp)}</td>
                    <td className="text-right tabular-nums">{money(totals.net)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
