import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CalculatorIcon, ExternalLinkIcon, FileTextIcon, HomeIcon, PencilIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/shared'
import { DOCUMENT_KIND_LABEL, openDocument, useLoanDocuments, type LoanDocument } from '@/lib/api/documents'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import { useCreateScenario, usePricingScenarios } from '@/lib/api/pricing'
import { useDeleteLien, useDeleteProperty, useProperties } from '@/lib/api/properties'
import type { Lien, LoanProfile, Property, PropertyStatus } from '@/lib/api/types'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { scenarioFrom, scenarioName } from '@/lib/pricing/scenario'
import { formatCurrency, formatPercent } from '@/lib/format'
import { LienDialog } from './LienDialog'
import { PropertyDialog } from './PropertyDialog'
import { propertyStatusLabel } from './options'

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function LienRow({ lien, onEdit, onDelete }: { lien: Lien; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {lien.position === 'first' ? '1st lien' : '2nd lien'}
          {lien.isHeloc && ' · HELOC'}
          {lien.lender && <span className="font-normal text-muted-foreground"> · {lien.lender}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatCurrency(lien.balance)} balance
          {lien.noteRate !== null && ` · ${formatPercent(lien.noteRate)}`}
          {lien.monthlyPayment !== null && ` · ${formatCurrency(lien.monthlyPayment)}/mo P&I`}
          {lien.originatedOn && ` · since ${formatIsoDate(lien.originatedOn)}`}
          {lien.isTexasCashOut && ' · TX cash-out'}
        </p>
      </div>
      <div className="flex gap-1">
        <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label="Edit lien">
          <PencilIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label="Delete lien">
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

function PropertyCard({
  property,
  isSubject,
  showRent,
  showLiens,
  onEdit,
  onMakeSubject,
  onDelete,
  onAddLien,
  onEditLien,
  onDeleteLien,
  documents,
  onPrice,
  pricing,
}: {
  property: Property
  isSubject: boolean
  showRent: boolean
  /** Existing mortgages: for a refinance or HELOC, and for homes the borrower owns (REO); not for homes being bought. */
  showLiens: boolean
  onEdit: () => void
  onMakeSubject: () => void
  onDelete: () => void
  onAddLien: () => void
  onEditLien: (lien: Lien) => void
  onDeleteLien: (lien: Lien) => void
  /** PDFs saved for this home (Fee Worksheets, comparisons, pre-approval letters). */
  documents: LoanDocument[]
  /** Opens this home's pricing scenario in Fees, starting one if there isn't one. */
  onPrice: () => void
  pricing: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const place = [property.city, [property.state, property.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return (
    <Card className={cn(isSubject && 'ring-2 ring-primary/40')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{property.addressLine}</h3>
              {isSubject && (
                <Badge>
                  <StarIcon />
                  Subject property
                </Badge>
              )}
              <Badge variant="secondary">{propertyStatusLabel(property.status)}</Badge>
              {property.isHomestead && <Badge variant="outline">Homestead</Badge>}
            </div>
            {place && <p className="text-sm text-muted-foreground">{place}</p>}
          </div>
          <div className="flex flex-wrap gap-1">
            {!isSubject && (
              <Button size="sm" variant="outline" onClick={onMakeSubject}>
                <StarIcon />
                Make subject property
              </Button>
            )}
            {property.listingUrl && (
              <Button size="sm" variant="ghost" asChild>
                <a href={property.listingUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon />
                  Listing
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onPrice} disabled={pricing}>
              <CalculatorIcon />
              Price this home
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <PencilIcon />
              Edit
            </Button>
            {confirmDelete ? (
              <>
                <Button size="sm" variant="destructive" onClick={onDelete}>
                  Confirm delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete property">
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="List price" value={formatCurrency(property.listPrice)} />
          <Figure label="Est. value" value={formatCurrency(property.estimatedValue)} />
          <Figure label="Taxes / yr" value={formatCurrency(property.annualTaxes)} />
          <Figure label="Insurance / yr" value={formatCurrency(property.annualInsurance)} />
          <Figure label="HOA / mo" value={formatCurrency(property.monthlyHoa)} />
          {(showRent || property.monthlyRent !== null) && <Figure label="Rent / mo" value={formatCurrency(property.monthlyRent)} />}
        </dl>

        {documents.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Saved for this home</p>
            <ul className="mt-1 space-y-1">
              {documents.map((d) => (
                <li key={d.id}>
                  <button type="button" className="flex items-center gap-1.5 text-left text-sm hover:underline" onClick={() => openDocument(d).catch((e: Error) => toast.error(e.message))}>
                    <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {DOCUMENT_KIND_LABEL[d.kind]}
                    <span className="text-xs text-muted-foreground">· {relativeTime(d.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showLiens && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Existing liens</p>
              {property.liens.length < 2 && (
                <Button size="xs" variant="ghost" onClick={onAddLien}>
                  <PlusIcon />
                  Add lien
                </Button>
              )}
            </div>
            {property.liens.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">None (free and clear, or not entered yet).</p>
            ) : (
              <ul className="divide-y">
                {property.liens.map((lien) => (
                  <LienRow key={lien.id} lien={lien} onEdit={() => onEditLien(lien)} onDelete={() => onDeleteLien(lien)} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'property'; property: Property | null }
  | { kind: 'lien'; property: Property; lien: Lien | null }

/** Homes on this loan. Any of them can be made the subject property. */
export function PropertiesTab({ loan }: { loan: LoanProfile }) {
  const properties = useProperties(loan.id)
  const updateDetails = useUpdateLoanDetails(loan.id)
  const deleteProperty = useDeleteProperty(loan.id)
  const deleteLien = useDeleteLien(loan.id)
  const scenarios = usePricingScenarios(loan.id)
  const createScenario = useCreateScenario(loan.id, loan.organizationId)
  const documents = useLoanDocuments(loan.id)
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })

  const subjectId = loan.details.subjectPropertyId
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && loan.details.purchasePrice !== null)
  const defaultStatus: PropertyStatus = isPurchase ? 'interested' : 'current_home'
  const showRent = loan.purpose === 'investment_dscr' || loan.details.occupancy === 'investment'
  const onError = (error: Error) => toast.error(error.message)

  const makeSubject = (id: string) =>
    updateDetails.mutate({ subjectPropertyId: id }, { onSuccess: () => toast.success('Subject property set'), onError })

  // The first current home or under-contract property becomes the subject automatically.
  const afterSave = (id: string, input: { status: PropertyStatus }) => {
    if (!subjectId && (input.status === 'current_home' || input.status === 'under_contract')) makeSubject(id)
  }

  const list = properties.data ?? []
  const openFees = (id: string) => navigate(`/loans/${loan.id}?tab=fees&scenario=${id}`)
  // Push to pricer: this home's newest scenario, or a new one from its numbers.
  const price = (property: Property) => {
    const existing = (scenarios.data ?? []).filter((x) => x.propertyId === property.id).at(-1)
    if (existing) return openFees(existing.id)
    createScenario.mutate(scenarioFrom(loan, property, scenarioName(property, scenarios.data?.length ?? 0)), { onSuccess: (x) => openFees(x.id), onError })
  }
  const sorted = [...list].sort((a, b) => Number(b.id === subjectId) - Number(a.id === subjectId))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isPurchase ? 'Homes the borrower is looking at. Make one the subject property once it goes under contract.' : 'The home this loan is on, plus its existing mortgages.'}
        </p>
        <Button onClick={() => setDialog({ kind: 'property', property: null })}>
          <PlusIcon />
          Add property
        </Button>
      </div>

      {properties.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {properties.isError && <p className="text-sm text-destructive">{properties.error.message}</p>}
      {properties.isSuccess && list.length === 0 && (
        <Card>
          <EmptyState
            icon={HomeIcon}
            title="No properties yet"
            description={isPurchase ? 'Add homes the borrower is interested in.' : 'Add the home being refinanced and its current mortgage.'}
            action={<Button variant="outline" onClick={() => setDialog({ kind: 'property', property: null })}><PlusIcon />Add property</Button>}
          />
        </Card>
      )}

      {sorted.map((property) => (
        <PropertyCard
          key={property.id}
          property={property}
          isSubject={property.id === subjectId}
          showRent={showRent}
          showLiens={hasExistingMortgages(property, isPurchase)}
          onEdit={() => setDialog({ kind: 'property', property })}
          onMakeSubject={() => makeSubject(property.id)}
          onDelete={() => deleteProperty.mutate(property.id, { onSuccess: () => toast.success('Property deleted'), onError })}
          onAddLien={() => setDialog({ kind: 'lien', property, lien: null })}
          onEditLien={(lien) => setDialog({ kind: 'lien', property, lien })}
          onDeleteLien={(lien) => deleteLien.mutate(lien.id, { onSuccess: () => toast.success('Lien deleted'), onError })}
          documents={(documents.data ?? []).filter((d) => d.propertyId === property.id)}
          onPrice={() => price(property)}
          pricing={createScenario.isPending || scenarios.isLoading}
        />
      ))}

      {dialog.kind === 'property' && (
        <PropertyDialog
          loanId={loan.id}
          organizationId={loan.organizationId}
          property={dialog.property}
          defaultStatus={defaultStatus}
          showRent={showRent}
          open
          onOpenChange={(open) => !open && setDialog({ kind: 'none' })}
          onSaved={afterSave}
        />
      )}
      {dialog.kind === 'lien' && (
        <LienDialog
          loanId={loan.id}
          organizationId={loan.organizationId}
          propertyId={dialog.property.id}
          lien={dialog.lien}
          takenPositions={dialog.property.liens.filter((l) => l.id !== dialog.lien?.id).map((l) => l.position)}
          open
          onOpenChange={(open) => !open && setDialog({ kind: 'none' })}
        />
      )}
    </div>
  )
}

/** Existing mortgages matter on a refinance or HELOC file, and on homes the borrower already owns (the 1003's REO); a home being bought has none. Liens already entered always show. */
export function hasExistingMortgages(property: Property, isPurchase: boolean): boolean {
  return !isPurchase || property.status === 'current_home' || property.status === 'owned' || property.liens.length > 0
}
