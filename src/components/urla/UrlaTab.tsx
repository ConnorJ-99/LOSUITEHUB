import { useRef, useState } from 'react'
import { DownloadIcon, FileUpIcon, PlusIcon, UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SummaryBar, ToggleChip } from '@/components/shared'
import { useProperties } from '@/lib/api/properties'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication, useRemoveBorrower } from '@/lib/api/urla'
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
import { applicationSummary } from '@/lib/urla/summary'
import type { UrlaIssue, UrlaValidation } from '@/lib/loanfile/urla'
import { UrlaSectionNav, focusIssue } from './UrlaSectionNav'

/**
 * The 1003 (Uniform Residential Loan Application), sectioned like the real
 * form, with one sticky section list showing each group's status (the same
 * validation as the sidebar's 1003 badge).
 */
export function UrlaTab({ loan, validation = null, onCompleteFields }: { loan: LoanProfile; validation?: UrlaValidation | null; onCompleteFields?: () => void }) {
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
  // The amber count: switch to that borrower if it's their field, then go to it.
  const goToIssue = (issue: UrlaIssue) => {
    const anchor = validation?.sections.find((s) => s.id === issue.section)?.anchor ?? 'section-1'
    const other = issue.contactId && issue.contactId !== borrower.contactId && borrowers.some((b) => b.contactId === issue.contactId)
    if (other) setSelectedId(issue.contactId!)
    setTimeout(() => focusIssue(issue, anchor), other ? 250 : 0)
  }
  // Key figures for the summary bar.
  const { subject, isPurchase, scenario, housing, qualifying: q } = applicationSummary(loan, app.data!, properties.data)

  // Remount a borrower's forms when their saved data changes, so they show what was saved.
  const borrowerKey = `${borrower.contactId}:${JSON.stringify(borrower.person)}`
  const declarationsKey = `${borrower.contactId}:${JSON.stringify(borrower.declarations)}`
  const { subjectPropertyId, ...loanDetailsForKey } = loan.details
  void subjectPropertyId

  return (
    <>
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[12.5rem_1fr]">
        <UrlaSectionNav validation={validation} onFirstMissing={goToIssue} onCompleteFields={onCompleteFields} />

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUpIcon />
              <span className="hidden sm:inline">Import MISMO</span>
              <span className="sm:hidden">Import</span>
            </Button>
            <Button onClick={() => setExporting(true)}>
              <DownloadIcon />
              <span className="hidden sm:inline">Export MISMO 3.4</span>
              <span className="sm:hidden">Export</span>
            </Button>
          </div>
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
