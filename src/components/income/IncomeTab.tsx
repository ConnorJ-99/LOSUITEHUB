import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalculatorIcon, PlusIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, SummaryBar, ToggleChip } from '@/components/shared'
import { useCreateWorksheet, useWorksheets } from '@/lib/api/income'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { employmentMonthlyIncome } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { computeWorksheet, defaultInputs, suggestedLabel, WORKSHEET_KINDS, type WorksheetData, type WorksheetKind } from '@/lib/income/worksheets'
import { fullName } from '@/lib/pipeline/helpers'
import { ownedProperties, propertyNetRental, usesScheduleE } from '@/lib/urla/realEstate'
import { applicationSummary } from '@/lib/urla/summary'
import { WorksheetCard, type IncomePdfRequest } from './WorksheetCard'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { INCOME_ANALYSIS_TEMPLATE, incomeAnalysisView } from '@/lib/documents/incomeAnalysis'
import { todayIso } from '@/lib/dates'
import { useCalculateIncome } from './useCalculateIncome'

const SELF_EMPLOYED_KINDS: WorksheetKind[] = ['schedule_c', 's_corp', 'partnership', 'bank_statement']

/** Income calculator: worksheets per borrower, each pushing its result into the 1003. */
export function IncomeTab({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const worksheets = useWorksheets(loan.id)
  const create = useCreateWorksheet(loan.id, loan.organizationId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const calc = useCalculateIncome(loan)
  const pdf = useSavePdf(loan)
  // "Calculate income" on an analyzed document lands here with ?calculate=<kind>&contact=<id> (one click, run once).
  const [params, setParams] = useSearchParams()
  const asked = useRef(false)
  const wanted = params.get('calculate') as 'wages' | 'bank_statement' | 'returns' | null
  const wantedFor = params.get('contact')
  const firstNameOf = (id: string) => app.data?.borrowers.find((b) => b.contactId === id)?.person.firstName ?? 'the borrower'
  useEffect(() => {
    if (!wanted || !wantedFor || asked.current || !calc.available || !app.data) return
    asked.current = true
    setSelectedId(wantedFor)
    void calc.calculate(wantedFor, firstNameOf(wantedFor), wanted)
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('calculate')
      next.delete('contact')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, wantedFor, calc.available, app.data])

  if (app.isLoading || worksheets.isLoading || properties.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading income…</p>
  const error = app.error ?? worksheets.error ?? properties.error
  if (error) return <p className="py-12 text-center text-sm text-destructive">{error.message}</p>
  const { borrowers } = app.data!
  if (borrowers.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">No borrower on this loan.</p>

  const borrower = borrowers.find((b) => b.contactId === selectedId) ?? borrowers[0]
  const summary = applicationSummary(loan, app.data!, properties.data)
  const q = summary.qualifying
  const borrowerIncome = summary.borrowerIncomes[borrowers.indexOf(borrower)]
  const mine = (worksheets.data ?? []).filter((w) => w.contactId === borrower.contactId)
  const jobs = borrower.employments.filter((e) => e.status === 'current')
  const otherIncome = borrower.otherIncomes.reduce((s, i) => s + i.monthlyAmount, 0)
  const subjectId = loan.details.subjectPropertyId
  const rentals = ownedProperties(properties.data).filter((p) => p.id !== subjectId && p.reoDisposition === 'retain')

  /** Starts a worksheet, pointed at the most likely job or property, and opens it. */
  const add = (kind: WorksheetKind) => {
    const selfEmployed = SELF_EMPLOYED_KINDS.includes(kind)
    const employment = kind === 'rental' ? null : (jobs.find((e) => e.isSelfEmployed === selfEmployed) ?? jobs[0] ?? null)
    const property = kind === 'rental' ? (rentals[0] ?? ownedProperties(properties.data)[0] ?? null) : null
    const inputs = defaultInputs(kind)
    create.mutate(
      {
        contactId: borrower.contactId,
        kind,
        label: suggestedLabel(kind, employment, property),
        inputs,
        resultMonthly: computeWorksheet({ kind, inputs } as WorksheetData).monthly,
        employmentId: employment?.id ?? null,
        propertyId: property?.id ?? null,
      },
      { onSuccess: (id) => setOpenId(id), onError: (e) => toast.error(e.message) },
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Borrower</span>
          {borrowers.map((b) => (
            <ToggleChip
              key={b.contactId}
              label={`${fullName(b.person)}${b.role === 'co_borrower' ? ' (co)' : ''}`}
              pressed={b.contactId === borrower.contactId}
              onChange={() => setSelectedId(b.contactId)}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-3">
            <Card title="Worksheets" description="Enter figures from pay stubs, W-2s, tax returns or bank statements, or calculate them from the analyzed uploads. Push the result to fill in the 1003.">
              <div className="flex flex-wrap gap-2">
                {calc.available && (
                  <Button size="sm" className="bg-money text-white hover:bg-money/90" disabled={calc.busy} onClick={() => void calc.calculate(borrower.contactId, borrower.person.firstName)} title="Fill draft worksheets from this borrower's analyzed pay stubs, W-2s, bank statements and tax returns">
                    <SparklesIcon />
                    {calc.busy ? 'Calculating…' : 'Calculate income'}
                  </Button>
                )}
                {WORKSHEET_KINDS.map((k) => (
                  <Button key={k.value} size="sm" variant="outline" onClick={() => add(k.value)} disabled={create.isPending}>
                    <PlusIcon />
                    {k.short}
                  </Button>
                ))}
              </div>
            </Card>

            {mine.length === 0 ? (
              <Card>
                <EmptyState icon={CalculatorIcon} title={`No worksheets for ${borrower.person.firstName} yet`} description="Pick a type above to start one. Each worksheet shows its math line by line." />
              </Card>
            ) : (
              <ul className="space-y-3">
                {mine.map((w) => (
                  <WorksheetCard
                    key={w.id}
                    worksheet={w}
                    borrower={borrower}
                    properties={properties.data ?? []}
                    subjectPropertyId={subjectId}
                    organizationId={loan.organizationId}
                    open={openId === w.id}
                    onToggle={() => setOpenId((id) => (id === w.id ? null : w.id))}
                    onPdf={(v: IncomePdfRequest) => {
                      const view = incomeAnalysisView({ borrowerName: fullName(borrower.person), label: v.label, typeLabel: v.typeLabel, where: v.where, lines: v.result.lines, monthly: v.result.monthly, warnings: v.result.warnings, notes: v.notes, sources: v.sources, draft: v.draft, pushedOn: v.pushedOn, preparedOn: todayIso() })
                      void pdf.save({ fileName: view.fileName, kind: 'income_analysis', propertyId: null, templateVersion: INCOME_ANALYSIS_TEMPLATE, tooLong: 'Shorten the label or notes.', render: (lib, brand) => lib.incomeAnalysisPdf(view, brand) })
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <Card title="On the 1003 now" description={`${borrower.person.firstName}'s monthly income`}>
              <dl className="space-y-2 text-sm">
                {jobs.length === 0 && <p className="text-muted-foreground">No current job on the 1003.</p>}
                {jobs.map((e) => (
                  <div key={e.id}>
                    <div className="flex justify-between gap-2">
                      <dt className="truncate font-medium">{e.employerName}</dt>
                      <dd className="tabular-nums">{formatCurrency(employmentMonthlyIncome(e))}</dd>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        e.baseIncome !== null && `Base ${formatCurrency(e.baseIncome)}`,
                        e.overtimeIncome !== null && `OT ${formatCurrency(e.overtimeIncome)}`,
                        e.bonusIncome !== null && `Bonus ${formatCurrency(e.bonusIncome)}`,
                        e.commissionIncome !== null && `Commission ${formatCurrency(e.commissionIncome)}`,
                        e.selfEmployedIncome !== null && `Self-employed ${formatCurrency(e.selfEmployedIncome)}`,
                      ].filter(Boolean).join(' · ') || 'No income entered'}
                    </p>
                  </div>
                ))}
                {otherIncome > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt>Other income</dt>
                    <dd className="tabular-nums">{formatCurrency(otherIncome)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2 border-t pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatCurrency(borrowerIncome)}</dd>
                </div>
              </dl>
            </Card>

            {rentals.length > 0 && (
              <Card title="Rental properties" description="Net after each property's payment, for all borrowers">
                <dl className="space-y-2 text-sm">
                  {rentals.map((p) => {
                    const net = propertyNetRental(p)
                    return (
                      <div key={p.id}>
                        <div className="flex justify-between gap-2">
                          <dt className="truncate font-medium">{p.addressLine}</dt>
                          <dd className={net < 0 ? 'text-destructive tabular-nums' : 'tabular-nums'}>{formatCurrency(net)}</dd>
                        </div>
                        <p className="text-xs text-muted-foreground">{usesScheduleE(p) ? 'Schedule E' : '75% of lease'}</p>
                      </div>
                    )
                  })}
                </dl>
              </Card>
            )}
          </div>
        </div>
      </div>

      <SummaryBar
        items={[
          { label: `${borrower.person.firstName} / mo`, value: formatCurrency(borrowerIncome) },
          { label: 'All income / mo', value: formatCurrency(q.totalIncome) },
          { label: 'Housing / mo', value: formatCurrency(summary.housing) },
          { label: 'Debts / mo', value: formatCurrency(q.otherDebts) },
          { label: 'DTI', value: q.dti.front === null ? '—' : `${formatPercent(q.dti.front, 1)} / ${formatPercent(q.dti.back, 1)}`, warning: (q.dti.back ?? 0) > 50 },
          ...(loan.purpose === 'investment_dscr' ? [{ label: 'DSCR', value: summary.scenario.dscr?.toFixed(2) ?? '—', warning: summary.scenario.dscr !== null && summary.scenario.dscr < 1 }] : []),
        ]}
      />
    </>
  )
}
