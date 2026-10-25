import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LienDialog } from '@/components/profile/LienDialog'
import { PropertyDialog } from '@/components/profile/PropertyDialog'
import { OCCUPANCY_OPTIONS, REO_DISPOSITION_OPTIONS } from '@/components/profile/options'
import { useDeleteLien, useProperties } from '@/lib/api/properties'
import type { Lien, LoanProfile, Property } from '@/lib/api/types'
import { formatCurrency, formatPercent } from '@/lib/format'
import { labelFor } from '@/lib/urla/options'
import { ownedProperties, propertyNetRental, usesScheduleE } from '@/lib/urla/realEstate'
import { AddButton, SectionCard } from './parts'

type DialogState = { kind: 'property'; property: Property | null } | { kind: 'lien'; property: Property; lien: Lien | null } | null

/**
 * Section 3: properties the borrowers own, read from the Properties tab (same
 * records, edited in either place) with their mortgages.
 */
export function RealEstateSection({ loan }: { loan: LoanProfile }) {
  const properties = useProperties(loan.id)
  const deleteLien = useDeleteLien(loan.id)
  const [dialog, setDialog] = useState<DialogState>(null)
  const owned = ownedProperties(properties.data)

  return (
    <SectionCard
      id="section-3"
      title="3. Real estate owned"
      description="Same records as the Properties tab. Mortgages go here, not in liabilities."
      action={<AddButton label="Add property owned" onClick={() => setDialog({ kind: 'property', property: null })} />}
    >
      {properties.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : owned.length === 0 ? (
        <p className="text-sm text-muted-foreground">The borrowers don't own any real estate yet (or it isn't entered).</p>
      ) : (
        <ul className="space-y-3">
          {owned.map((p) => {
            const net =
              p.reoDisposition === 'retain' && p.id !== loan.details.subjectPropertyId
                ? propertyNetRental(p)
                : null
            return (
              <li key={p.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.addressLine}
                      {p.city && `, ${p.city}`} {p.state}
                      {p.id === loan.details.subjectPropertyId && <span className="ml-2 text-xs font-normal text-primary">Subject property</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        formatCurrency(p.estimatedValue) + ' value',
                        p.reoDisposition && labelFor(REO_DISPOSITION_OPTIONS, p.reoDisposition),
                        p.reoOccupancy && labelFor(OCCUPANCY_OPTIONS, p.reoOccupancy),
                        p.monthlyRent !== null && `${formatCurrency(p.monthlyRent)}/mo rent`,
                        net !== null && `net rental ${formatCurrency(net)}/mo ${usesScheduleE(p) ? '(Schedule E)' : '(75% of lease)'}`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setDialog({ kind: 'property', property: p })}>
                      Edit
                    </Button>
                    {p.liens.length < 2 && (
                      <Button size="xs" variant="ghost" onClick={() => setDialog({ kind: 'lien', property: p, lien: null })}>
                        Add mortgage
                      </Button>
                    )}
                  </div>
                </div>
                {p.liens.length > 0 && (
                  <ul className="mt-2 divide-y border-t">
                    {p.liens.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                        <button type="button" className="text-left text-muted-foreground hover:text-foreground" onClick={() => setDialog({ kind: 'lien', property: p, lien: l })}>
                          <span className="font-medium text-foreground">{l.position === 'first' ? '1st' : '2nd'}{l.isHeloc ? ' HELOC' : ''}</span>
                          {l.lender && ` · ${l.lender}`} · {formatCurrency(l.balance)} balance
                          {l.noteRate !== null && ` · ${formatPercent(l.noteRate)}`}
                          {l.monthlyPayment !== null && ` · ${formatCurrency(l.monthlyPayment)}/mo`}
                          {l.toBePaidOff && <span className="text-primary"> · paid off at closing</span>}
                        </button>
                        <Button size="xs" variant="ghost" onClick={() => deleteLien.mutate(l.id, { onError: (e) => toast.error(e.message) })}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {dialog?.kind === 'property' && (
        <PropertyDialog
          loanId={loan.id}
          organizationId={loan.organizationId}
          property={dialog.property}
          defaultStatus="owned"
          showRent
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      {dialog?.kind === 'lien' && (
        <LienDialog
          loanId={loan.id}
          organizationId={loan.organizationId}
          propertyId={dialog.property.id}
          lien={dialog.lien}
          takenPositions={dialog.property.liens.filter((l) => l.id !== dialog.lien?.id).map((l) => l.position)}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
    </SectionCard>
  )
}
