import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarHeartIcon, DownloadIcon, LandmarkIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, SearchInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS } from '@/components/profile/options'
import { useClosedLoans, type ClosedLoan } from '@/lib/api/closed'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { downloadText } from '@/lib/download'
import { formatCompactCurrency, formatCurrency, formatPercent } from '@/lib/format'
import { keyDates, type KeyDate } from '@/lib/closed/keyDates'
import { closingYear, closingYears, NOT_RECORDED, production, type ProductionGroup } from '@/lib/closed/production'
import { toCsv } from '@/lib/import/csv'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'

const ALL = 'all'
const typeLabel = (v: string) => MORTGAGE_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
const labels = { loanType: typeLabel, purpose: (v: string) => purposeLabel(v as ClosedLoan['purpose']) }
const borrowerName = (l: ClosedLoan) => (l.borrower ? fullName(l.borrower) : 'No borrower')
const homeLine = (l: ClosedLoan) => (l.home ? [l.home.addressLine, l.home.city].filter(Boolean).join(', ') : null)

/** Closed loans: production by year, lender, loan officer and loan type; the list by year; upcoming key dates. */
export function ClosedLoansTab() {
  const closed = useClosedLoans()
  const navigate = useNavigate()
  const [year, setYear] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [lo, setLo] = useState(ALL)
  const [loanType, setLoanType] = useState(ALL)
  const [lender, setLender] = useState(ALL)
  const today = todayIso()

  const loans = useMemo(() => closed.data ?? [], [closed.data])
  const years = closingYears(loans)
  const options = (values: (string | null)[]) => [{ value: ALL, label: 'All' }, ...[...new Set(values.map((v) => v ?? NOT_RECORDED))].sort().map((v) => ({ value: v, label: v }))]

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return loans.filter((l) => {
      if (year !== null && closingYear(l) !== year) return false
      if (lo !== ALL && (l.lo?.name ?? NOT_RECORDED) !== lo) return false
      if (loanType !== ALL && (l.loanType ? typeLabel(l.loanType) : NOT_RECORDED) !== loanType) return false
      if (lender !== ALL && (l.lender ?? NOT_RECORDED) !== lender) return false
      if (!q) return true
      const people = [l.borrower, ...l.coBorrowers].filter(Boolean)
      return [...people.flatMap((p) => [fullName(p!), p!.email ?? '', (p!.phone ?? '').replace(/\D/g, '')]), homeLine(l) ?? '', l.lender ?? ''].some((v) => v.toLowerCase().includes(q))
    })
  }, [loans, year, lo, loanType, lender, search])

  const stats = production(
    shown.map((l) => ({ closingDate: l.closingDate, loanAmount: l.loanAmount, lender: l.lender, loName: l.lo?.name ?? null, loanType: l.loanType, purpose: l.purpose })),
    labels,
  )
  const byYear = useMemo(() => {
    const groups = new Map<string, ClosedLoan[]>()
    for (const l of shown) {
      const key = String(closingYear(l) ?? 'No closing date')
      groups.set(key, [...(groups.get(key) ?? []), l])
    }
    return [...groups.entries()]
  }, [shown])
  const upcoming = useMemo(
    () =>
      shown
        .flatMap((l) =>
          keyDates(
            { closingDate: l.closingDate, firstPaymentDate: l.firstPaymentDate, birthday: l.borrower?.birthday ?? null, insuranceRenewalDate: l.home?.insuranceRenewalDate ?? null, homesteadFiled: l.home?.homesteadFiled ?? null, occupancy: l.occupancy },
            today,
            30,
          ).map((d) => ({ ...d, loan: l })),
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 12),
    [shown, today],
  )

  const exportCsv = () =>
    downloadText(
      `closed-loans${year ? `-${year}` : ''}.csv`,
      toCsv([
        ['closing_date', 'first_name', 'last_name', 'email', 'phone', 'co_borrowers', 'lo', 'lender', 'program', 'loan_type', 'loan_purpose', 'loan_amount', 'purchase_price', 'rate', 'term_years', 'monthly_payment', 'property_address', 'property_city', 'property_state', 'property_zip', 'insurance_carrier', 'insurance_renewal_date', 'homestead_filed'],
        ...shown.map((l) => [
          l.closingDate, l.borrower?.firstName, l.borrower?.lastName, l.borrower?.email, l.borrower?.phone, l.coBorrowers.map((c) => fullName(c)).join('; '),
          l.lo?.name, l.lender, l.program, l.loanType ? typeLabel(l.loanType) : '', purposeLabel(l.purpose), l.loanAmount, l.purchasePrice, l.rate,
          l.termMonths ? l.termMonths / 12 : '', l.monthlyPayment, l.home?.addressLine, l.home?.city, l.home?.state, l.home?.zip,
          l.home?.insuranceCarrier, l.home?.insuranceRenewalDate, l.home?.homesteadFiled == null ? '' : l.home.homesteadFiled ? 'Yes' : 'No',
        ]),
      ]),
      'text/csv',
    )

  if (closed.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (closed.isError) return <Card><EmptyState icon={TriangleAlertIcon} title="Couldn't load closed loans" description={closed.error.message} /></Card>
  if (loans.length === 0) {
    return (
      <Card>
        <EmptyState icon={LandmarkIcon} title="No closed loans yet" description="Files you move to Closed, and closed clients you import, show here with your production by year." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <ToggleChipGroup>
        <ToggleChip label={`All years ${loans.length}`} pressed={year === null} onChange={() => setYear(null)} />
        {years.map((y) => (
          <ToggleChip key={y} label={`${y} ${loans.filter((l) => closingYear(l) === y).length}`} pressed={year === y} onChange={(on) => setYear(on ? y : null)} />
        ))}
      </ToggleChipGroup>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Loans closed" value={String(stats.count)} />
        <Stat label="Volume" value={formatCurrency(stats.volume)} note={stats.missingAmount ? `${stats.missingAmount} without a loan amount` : undefined} />
        <Stat label="Average loan" value={formatCurrency(stats.average)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown title="By lender" groups={stats.byLender} />
        <Breakdown title="By loan officer" groups={stats.byLo} />
        <Breakdown title="By loan type" groups={stats.byLoanType} />
      </div>

      {upcoming.length > 0 && (
        <Card title="Coming up in the next 30 days" description="Key dates for these clients. Open a file to add the follow-up as a task.">
          <ul className="divide-y text-sm">
            {upcoming.map((d: KeyDate & { loan: ClosedLoan }) => (
              <li key={`${d.loan.id}-${d.sourceKey}`}>
                <button type="button" className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted/40" onClick={() => navigate(`/loans/${d.loan.id}`)}>
                  <CalendarHeartIcon className="size-4 shrink-0 text-primary" />
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatIsoDate(d.date)}</span>
                  <span className="font-medium">{borrowerName(d.loan)}</span>
                  <span className="text-muted-foreground">{d.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, phone, email, address or lender" className="w-full sm:w-72" />
        <div className="w-44"><Select label="Loan officer" value={lo} onChange={setLo} options={options(loans.map((l) => l.lo?.name ?? null))} /></div>
        <div className="w-40"><Select label="Loan type" value={loanType} onChange={setLoanType} options={options(loans.map((l) => (l.loanType ? typeLabel(l.loanType) : null)))} /></div>
        <div className="w-48"><Select label="Lender" value={lender} onChange={setLender} options={options(loans.map((l) => l.lender))} /></div>
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={shown.length === 0}>
          <DownloadIcon />
          Export CSV
        </Button>
      </div>

      {shown.length === 0 && <Card><EmptyState title="No closed loans match" description="Try a different search or filter." /></Card>}
      {byYear.map(([label, group]) => (
        <Card
          key={label}
          title={label}
          description={`${group.length} loan${group.length === 1 ? '' : 's'} · ${formatCompactCurrency(group.reduce((s, l) => s + (l.loanAmount ?? 0), 0))}`}
          contentClassName="px-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Closed</th>
                  <th className="px-4 py-2 text-left font-medium">Client</th>
                  <th className="hidden px-4 py-2 text-left font-medium md:table-cell">Property</th>
                  <th className="hidden px-4 py-2 text-left font-medium md:table-cell">Lender</th>
                  <th className="hidden px-4 py-2 text-left font-medium md:table-cell">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Rate</th>
                  <th className="hidden px-4 py-2 text-left font-medium lg:table-cell">Loan officer</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {group.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/loans/${l.id}`)}>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{l.closingDate ? formatIsoDate(l.closingDate) : '—'}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{borrowerName(l)}{l.coBorrowers.length > 0 && <span className="font-normal text-muted-foreground"> & {l.coBorrowers.map((c) => c.firstName).join(', ')}</span>}</p>
                      <p className={cn('text-xs', l.borrower?.email ? 'text-muted-foreground' : 'text-amber-700')}>
                        {[formatPhone(l.borrower?.phone), l.borrower?.email ?? 'No email'].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="hidden px-4 py-2 md:table-cell">{homeLine(l) ?? '—'}</td>
                    <td className="hidden px-4 py-2 md:table-cell">{l.lender ?? '—'}</td>
                    <td className="hidden px-4 py-2 md:table-cell">{[l.loanType ? typeLabel(l.loanType) : null, purposeLabel(l.purpose)].filter(Boolean).join(' · ')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(l.loanAmount)}</td>
                    <td className="hidden px-4 py-2 text-right tabular-nums md:table-cell">{l.rate === null ? '—' : formatPercent(l.rate)}</td>
                    <td className="hidden px-4 py-2 lg:table-cell">{l.lo?.name ?? 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-soft">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {note && <p className="text-xs text-amber-700">{note}</p>}
    </div>
  )
}

function Breakdown({ title, groups }: { title: string; groups: ProductionGroup[] }) {
  return (
    <Card title={title}>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {groups.slice(0, 8).map((g) => (
            <li key={g.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn('truncate', g.label === NOT_RECORDED && 'text-muted-foreground')}>{g.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {g.count} · {formatCompactCurrency(g.volume)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(g.share * 100)}%` }} />
              </div>
            </li>
          ))}
          {groups.length > 8 && <li className="text-xs text-muted-foreground">and {groups.length - 8} more</li>}
        </ul>
      )}
    </Card>
  )
}
