import { useRef, useState } from 'react'
import { DownloadIcon, FileUpIcon, PlusIcon, UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SummaryBar, ToggleChip } from '@/components/shared'
import { useProperties } from '@/lib/api/properties'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication, useRemoveBorrower } from '@/lib/api/urla'
import { borrowerMonthlyIncome, computeScenario, netMonthlyRental, proposedHousingPayment, qualifying } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { fullName } from '@/lib/pipeline/helpers'
import { AddressesSection } from './AddressesSection'
import { AssetsSection, LiabilitiesSection } from './AssetLiabilitySections'
import { CoBorrowerDialog } from './CoBorrowerDialog'
import { DeclarationsSection, DemographicsSection } from './DeclarationsSections'
import { MismoImportError, parseMismo34, type ImportResult } from '@/lib/mismo/parse'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'
import { EmploymentSection, OtherIncomeSection } from './IncomeSections'
import { LoanInfoSection } from './LoanInfoSection'
import { OriginatorSection } from './OriginatorSection'
import { PersonSection } from './PersonSection'
import { RealEstateSection } from './RealEstateSection'
import { ownedProperties } from '@/lib/urla/realEstate'

const NAV = [
  { id: 'section-1', label: '1. Borrower' },
  { id: 'section-2', label: '2. Assets & liabilities' },
  { id: 'section-3', label: '3. Real estate' },
  { id: 'section-4', label: '4. Loan & property' },
  { id: 'section-5', label: '5. Declarations' },
  { id: 'section-8', label: '8. Demographics' },
  { id: 'section-9', label: '9. Originator' },
]

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** The 1003 (Uniform Residential Loan Application), sectioned like the real form. */
export function UrlaTab({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const removeBorrower = useRemoveBorrower(loan.id)
  const organization = useOrganization()
  const originator = useProfile(loan.assignedLo?.id)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState<{ fileName: string; result: ImportResult } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Read the chosen file and open the import preview. Nothing is saved until the user confirms. */
  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setImporting({ fileName: file.name, result: parseMismo34(await file.text()) })
    } catch (e) {
      toast.error(e instanceof MismoImportError ? e.message : `Couldn't read that file: ${(e as Error).message}`)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  if (app.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading 1003…</p>
  if (app.isError) return <p className="py-12 text-center text-sm text-destructive">{app.error.message}</p>
  const { borrowers, assets, liabilities } = app.data!
  if (borrowers.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">No borrower on this loan.</p>

  const borrower = borrowers.find((b) => b.contactId === selectedId) ?? borrowers[0]
  const subject = properties.data?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && loan.details.purchasePrice !== null)

  // Key figures for the summary bar.
  const scenarioInput = {
    purpose: loan.purpose,
    purchasePrice: loan.details.purchasePrice,
    loanAmount: loan.details.loanAmount,
    noteRatePct: loan.details.noteRate,
    termMonths: loan.details.termMonths,
    property: subject,
    liens: subject?.liens ?? [],
  }
  const scenario = computeScenario(scenarioInput)
  const housing = proposedHousingPayment(scenarioInput, scenario)
  const rentalNets = ownedProperties(properties.data)
    .filter((p) => p.id !== loan.details.subjectPropertyId && p.reoDisposition === 'retain')
    .map((p) =>
      netMonthlyRental({
        monthlyRent: p.monthlyRent,
        annualTaxes: p.annualTaxes,
        annualInsurance: p.annualInsurance,
        monthlyHoa: p.monthlyHoa,
        lienPayments: p.liens.filter((l) => !l.toBePaidOff).map((l) => l.monthlyPayment ?? 0),
      }),
    )
  const q = qualifying({
    borrowerIncomes: borrowers.map((b) => borrowerMonthlyIncome(b.employments, b.otherIncomes.map((i) => i.monthlyAmount)).total),
    housingPayment: housing ?? 0,
    debts: liabilities,
    rentalNets,
  })

  // Remount a borrower's forms when their saved data changes, so they show what was saved.
  const borrowerKey = `${borrower.contactId}:${JSON.stringify(borrower.person)}`
  const declarationsKey = `${borrower.contactId}:${JSON.stringify(borrower.declarations)}`
  const { subjectPropertyId, ...loanDetailsForKey } = loan.details
  void subjectPropertyId

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[11rem_1fr]">
        <nav aria-label="1003 sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5 text-sm">
            {NAV.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => jump(n.id)} className="w-full rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground">
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
            <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Borrower</span>
            {borrowers.map((b) => (
              <ToggleChip
                key={b.contactId}
                label={`${fullName(b.person)}${b.role === 'co_borrower' ? ' (co)' : ''}`}
                pressed={b.contactId === borrower.contactId}
                onChange={() => {
                  setSelectedId(b.contactId)
                  setConfirmRemove(false)
                }}
              />
            ))}
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add co-borrower
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              <FileUpIcon />
              Import MISMO file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xml,application/xml,text/xml"
              className="hidden"
              aria-label="MISMO 3.4 file to import"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {borrower.role === 'co_borrower' && (
              <div className="ml-auto">
                {confirmRemove ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        removeBorrower.mutate(borrower.contactId, {
                          onSuccess: () => {
                            toast.success('Co-borrower removed from this loan')
                            setSelectedId(null)
                            setConfirmRemove(false)
                          },
                          onError: (e) => toast.error(e.message),
                        })
                      }
                    >
                      Remove {borrower.person.firstName} and their assets/debts on this loan
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmRemove(true)}>
                    <UserMinusIcon />
                    Remove from loan
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <PersonSection key={borrowerKey} loanId={loan.id} borrower={borrower} />
            <AddressesSection loanId={loan.id} organizationId={loan.organizationId} borrower={borrower} />
            <EmploymentSection loanId={loan.id} organizationId={loan.organizationId} borrower={borrower} />
            <OtherIncomeSection loanId={loan.id} organizationId={loan.organizationId} borrower={borrower} />
            <AssetsSection loanId={loan.id} organizationId={loan.organizationId} borrowers={borrowers} assets={assets} />
            <LiabilitiesSection loanId={loan.id} organizationId={loan.organizationId} borrowers={borrowers} liabilities={liabilities} />
            <RealEstateSection loan={loan} />
            <LoanInfoSection key={JSON.stringify(loanDetailsForKey)} loan={loan} subject={subject} scenario={scenario} assets={assets} />
            <DeclarationsSection key={`d-${declarationsKey}`} loanId={loan.id} borrower={borrower} isPurchase={isPurchase} />
            <DemographicsSection key={`h-${declarationsKey}`} loanId={loan.id} borrower={borrower} />
            <OriginatorSection loan={loan} />
          </div>
        </div>
      </div>

      <SummaryBar
        items={[
          { label: 'Loan amount', value: formatCurrency(loan.details.loanAmount) },
          { label: isPurchase ? 'LTV' : 'CLTV', value: formatPercent(isPurchase ? scenario.ltv : scenario.cltv) },
          { label: 'Income / mo', value: formatCurrency(q.totalIncome) },
          { label: 'Housing / mo', value: formatCurrency(housing) },
          { label: 'Debts / mo', value: formatCurrency(q.otherDebts) },
          { label: 'DTI', value: q.dti.front === null ? '—' : `${formatPercent(q.dti.front, 1)} / ${formatPercent(q.dti.back, 1)}`, warning: (q.dti.back ?? 0) > 50 },
        ]}
        action={
          <Button onClick={() => setExporting(true)}>
            <DownloadIcon />
            <span className="hidden sm:inline">Export MISMO 3.4</span>
            <span className="sm:hidden">Export</span>
          </Button>
        }
      />

      {importing && (
        <ImportDialog
          loan={loan}
          fileName={importing.fileName}
          result={importing.result}
          existingBorrowers={borrowers}
          existingProperties={properties.data ?? []}
          onClose={() => setImporting(null)}
        />
      )}

      {exporting && (
        <ExportDialog
          loan={loan}
          application={app.data!}
          properties={properties.data ?? []}
          organization={organization.data ?? null}
          originator={originator.data ?? null}
          onClose={() => setExporting(false)}
        />
      )}

      {adding && (
        <CoBorrowerDialog
          loanId={loan.id}
          existingBorrowerIds={borrowers.map((b) => b.contactId)}
          onClose={() => setAdding(false)}
          onAdded={(id) => setSelectedId(id)}
        />
      )}
    </>
  )
}
