import { LayersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Card, ToggleChip } from '@/components/shared'
import { useSetCollateral } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { collateralHomes, collateralSummary } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'

// Cross-collateralized DSCR loans (Connor, 2026-11-09): several homes secure
// one loan, so the full value of all of them counts. The switch lives on the
// loan (Prequal tab and Overview); the homes are picked on the Properties tab.

/** The cross-collateral switch shows on DSCR files (the DSCR purpose, or DSCR income documentation), or once it's on. */
export const showsCrossCollateral = (loan: LoanProfile) =>
  loan.purpose === 'investment_dscr' || loan.details.incomeDocType === 'dscr' || loan.details.crossCollateral

/** "Use as collateral" on a home that isn't the subject property, while the loan is cross-collateralized. */
export function CollateralSwitch({ loan, property }: { loan: LoanProfile; property: Property }) {
  const setCollateral = useSetCollateral(loan.id)
  return (
    <ToggleChip
      label="Use as collateral"
      pressed={property.isCollateral}
      disabled={setCollateral.isPending}
      onChange={(on) =>
        setCollateral.mutate(
          { id: property.id, isCollateral: on },
          { onSuccess: () => toast.success(on ? 'Added as collateral' : 'Removed as collateral'), onError: (e) => toast.error(e.message) },
        )
      }
    />
  )
}

/** The combined line at the top of the Properties tab on a cross-collateralized loan. */
export function CollateralSummaryCard({ loan, properties }: { loan: LoanProfile; properties: Property[] }) {
  const subject = properties.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  if (!subject) {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayersIcon className="size-4 shrink-0" />
          Cross-collateralized loan: make one home the subject property first, then mark the other homes "Use as collateral".
        </p>
      </Card>
    )
  }
  const others = collateralHomes(true, subject.id, properties)
  const s = collateralSummary(subject, others)
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <LayersIcon className="size-4 shrink-0 text-primary" />
          Cross-collateralized · {s.count} {s.count === 1 ? 'property' : 'properties'}
        </p>
        <p>
          Combined value <span className="font-medium tabular-nums">{formatCurrency(s.value)}</span>
        </p>
        <p>
          Existing mortgages <span className="font-medium tabular-nums">{formatCurrency(s.existingMortgages)}</span>
        </p>
        <p>
          Combined rent <span className="font-medium tabular-nums">{formatCurrency(s.monthlyRent)}</span>/mo
        </p>
      </div>
      {others.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Mark the other homes below with "Use as collateral" to add their value and rent.</p>}
      {s.missingValues > 0 && (
        <p className="mt-2 text-xs text-amber-800">
          {s.missingValues} {s.missingValues === 1 ? 'home has' : 'homes have'} no value yet, so {s.missingValues === 1 ? 'it adds' : 'they add'} nothing to the combined value.
        </p>
      )}
    </Card>
  )
}
