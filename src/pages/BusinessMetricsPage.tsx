import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { Card, DateInput, EmptyState, PageHeader, Select } from '@/components/shared'
import { useLenders } from '@/lib/api/lenders'
import { useMetricsFiles } from '@/lib/api/metrics'
import { useRegisterLoans } from '@/lib/api/register'
import { useAuth } from '@/lib/auth/context'
import { registerRow } from '@/lib/closed/register'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { businessMetrics, lastMonths, metricsByLo, PERIODS, periodRange, type BusinessMetrics, type MetricsFilters, type PeriodId } from '@/lib/metrics/business'

const ALL = 'all'
const money = (v: number | null) => (v == null ? '—' : formatCurrency(v))
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)

const TILES: { key: string; label: string; help: string; value: (m: BusinessMetrics) => string; sub?: (m: BusinessMetrics) => string | null }[] = [
  { key: 'leads', label: 'New leads', help: 'Unique people with a new file in the period (imports left out)', value: (m) => String(m.newLeads) },
  { key: 'active', label: 'Active clients', help: 'Borrowers working toward a loan today: Pre-Qualified through Clear to Close', value: (m) => String(m.activeClients), sub: () => 'Right now, not by period' },
  { key: 'closed', label: 'Closed loans', help: 'Funded loans, counted on the funding date (else the closing date)', value: (m) => String(m.closedLoans) },
  { key: 'volume', label: 'Funded volume', help: 'Total loan amount of the funded loans', value: (m) => money(m.fundedVolume) },
  { key: 'avg', label: 'Average loan amount', help: 'Funded volume divided by closed loans', value: (m) => money(m.averageLoan) },
  { key: 'conv', label: 'Lead-to-close conversion', help: "Of the period's new leads, the share whose file has closed so far", value: (m) => pct(m.conversionPct), sub: (m) => (m.newLeads ? `${m.convertedLeads} of ${m.newLeads} leads` : null) },
  { key: 'gross', label: 'Gross revenue', help: 'Company compensation on the funded loans, before splits', value: (m) => money(m.grossRevenue) },
  { key: 'lo', label: 'LO compensation', help: "Owed to loan officers, from each loan's comp snapshot", value: (m) => money(m.loComp) },
  { key: 'company', label: 'Company revenue', help: 'Gross revenue less LO compensation (direct costs are not tracked yet)', value: (m) => money(m.companyRevenue) },
]

/**
 * Business metrics (Admin, owners and admins): leads, active clients, funded
 * loans, volume, conversion and revenue for a period, by loan officer and by
 * month. Read only; the money is the Closed loan register's.
 */
export function BusinessMetricsPage() {
  const { state } = useAuth()
  const role = state.status === 'signedIn' ? state.user.role : null
  const allowed = role === 'owner' || role === 'admin'
  const today = todayIso()
  const [period, setPeriod] = useState<PeriodId>('this_month')
  const [f, setF] = useState<MetricsFilters>({ ...periodRange('this_month', today), loId: null, leadSource: null })
  const lenders = useLenders()
  const closedLoans = useRegisterLoans(lenders.data?.map((l) => ({ id: l.id, name: l.name })))
  const files = useMetricsFiles()

  const closed = useMemo(() => (closedLoans.data ?? []).map((l) => registerRow(l, [])), [closedLoans.data])
  const list = useMemo(() => files.data?.files ?? [], [files.data])
  const names = useMemo(() => {
    const m = new Map(files.data?.names ?? [])
    for (const r of closed) if (r.loId && r.loName) m.set(r.loId, r.loName)
    return m
  }, [files.data, closed])
  const m = useMemo(() => businessMetrics(list, closed, f), [list, closed, f])
  const byLo = useMemo(() => metricsByLo(list, closed, f, names), [list, closed, f, names])
  const months = useMemo(() => lastMonths(today, 12).map((mo) => ({ ...mo, m: businessMetrics(list, closed, { ...f, from: mo.from, to: mo.to }) })).reverse(), [list, closed, f, today])

  if (!allowed) return <EmptyState title="Owners and admins only" description="Business metrics are in the Admin section." />
  const loading = files.isLoading || closedLoans.isLoading || lenders.isLoading
  const error = files.error ?? closedLoans.error

  const pick = (id: PeriodId) => {
    setPeriod(id)
    if (id !== 'custom') setF({ ...f, ...periodRange(id, today) })
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Business metrics"
        description={role === 'admin' ? 'Every file in the company.' : 'Only the files your login can see. Sign in with the Admin login to see the whole company.'}
      />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select label="Period" value={period} options={PERIODS.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => pick(v as PeriodId)} />
          <DateInput label="From" value={f.from} onChange={(from) => (setPeriod('custom'), setF({ ...f, from: from ?? f.from }))} />
          <DateInput label="To" value={f.to} onChange={(to) => (setPeriod('custom'), setF({ ...f, to: to ?? f.to }))} />
          <Select label="Loan officer" value={f.loId ?? ALL} options={[{ value: ALL, label: 'Everyone' }, ...[...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))]} onChange={(v) => setF({ ...f, loId: v === ALL ? null : v })} />
          <Select label="Lead source" value={f.leadSource ?? ALL} options={[{ value: ALL, label: 'All' }, { value: 'company', label: 'Company-generated' }, { value: 'self', label: 'Self-generated' }]} onChange={(v) => setF({ ...f, leadSource: v === ALL ? null : (v as 'company' | 'self') })} />
        </div>
      </Card>

      {loading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {error && <EmptyState title="The metrics could not load" description={error.message} />}
      {!loading && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {TILES.map((t) => (
              <div key={t.key} className="rounded-xl border bg-white p-4 shadow-soft" title={t.help}>
                <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{t.value(m)}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t.sub?.(m) ?? t.help}</p>
              </div>
            ))}
          </div>

          {m.missingRevenue > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {m.missingRevenue} closed loan{m.missingRevenue === 1 ? ' has' : 's have'} no revenue entered, so the revenue figures leave {m.missingRevenue === 1 ? 'it' : 'them'} out.{' '}
                <Link to="/closed-register" className="font-medium underline">
                  Open the Closed loan register
                </Link>
              </span>
            </p>
          )}

          <Card title="By loan officer" description="Same period and filters. Active clients are as of today.">
            <MetricsTable rows={byLo.map((r) => ({ key: r.loId ?? 'none', label: r.name, m: r.m }))} />
          </Card>

          <Card title="By month" description="The last 12 months, with the loan officer and lead source filters. Active clients are only shown as of today, above.">
            <MetricsTable rows={months.map((mo) => ({ key: mo.from, label: mo.label, m: mo.m }))} noActive />
          </Card>
        </div>
      )}
    </>
  )
}

function MetricsTable({ rows, noActive }: { rows: { key: string; label: string; m: BusinessMetrics }[]; noActive?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in this period.</p>
  const cols: [string, (m: BusinessMetrics) => string][] = [
    ['Leads', (m) => String(m.newLeads)],
    ...(noActive ? [] : ([['Active', (m: BusinessMetrics) => String(m.activeClients)]] as [string, (m: BusinessMetrics) => string][])),
    ['Closed', (m) => String(m.closedLoans)],
    ['Volume', (m) => money(m.fundedVolume)],
    ['Avg loan', (m) => money(m.averageLoan)],
    ['Conversion', (m) => pct(m.conversionPct)],
    ['Gross', (m) => money(m.grossRevenue)],
    ['LO comp', (m) => money(m.loComp)],
    ['Company', (m) => money(m.companyRevenue)],
  ]
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm tabular-nums">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-1.5 font-medium" />
            {cols.map(([h]) => (
              <th key={h} className="px-2 py-1.5 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="px-2 py-1.5 font-medium">{r.label}</td>
              {cols.map(([h, v]) => (
                <td key={h} className="px-2 py-1.5 text-right">
                  {v(r.m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
