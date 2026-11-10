import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/shared'
import { programAsReading, useApprovedReadings, useStartTypedMatrix } from '@/lib/api/matrixImports'
import { useCatalog } from '@/lib/api/products'
import { useAuth } from '@/lib/auth/context'
import { settingsText } from '@/lib/products/matrixImport'
import { printedLabels, tierReview, type PrintedLabels, type TierReviewItem } from '@/lib/products/tierReview'
import { gridsFromCells } from '@/lib/products/typedMatrix'
import { withProposed } from '@/lib/products/tierReview'
import type { CatalogProgram } from '@/lib/products/types'

/**
 * Matrices approved before loan amounts could be read as maximums: every approved program with more than one
 * loan-amount tier, how it reads now, the reading its printed headers suggest, and which standard scenarios
 * would change. Nothing changes here: "Review & approve" opens a draft on the usual review screen, and approving
 * that saves a new matrix version (the old one is kept).
 */
export function TierReview({ canEdit }: { canEdit: boolean }) {
  const catalog = useCatalog()
  const readings = useApprovedReadings()
  const labels = useMemo(() => printedLabels(readings.data ?? []), [readings.data])
  const items = useMemo(() => (catalog.data ? tierReview(catalog.data, labels) : []), [catalog.data, labels])
  const programs = useMemo(() => new Map((catalog.data?.programs ?? []).map((p) => [p.id, p])), [catalog.data])

  if (catalog.isLoading || readings.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Checking every approved matrix…</p>
  const error = catalog.error ?? readings.error
  if (error) return <p className="py-12 text-center text-sm text-destructive">{error.message}</p>
  const changing = items.filter((i) => i.changes)
  const unsure = items.filter((i) => !i.changes && i.grids.some((g) => !g.confident))
  const fine = items.filter((i) => !i.changes && i.grids.every((g) => g.confident))

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm">
          {items.length === 0
            ? 'No approved matrix has more than one loan-amount tier.'
            : `${items.length} approved program${items.length === 1 ? ' has' : 's have'} a matrix with more than one loan-amount tier: ${changing.length} look like maximums read as ranges, ${unsure.length} need a look at the PDF, ${fine.length} read correctly.`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Nothing on this page changes a matrix. Product Search keeps using each approved matrix as it is until you open it, check it and approve the new version.</p>
      </Card>
      {items.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to review" description="Matrices with one loan-amount tier read the same either way." />
        </Card>
      ) : (
        <>
          <Group title="Proposed change: loan amounts are maximums" description="The lender's own headers say maximums, but the matrix was saved as ranges. The scenarios listed are the ones whose result changes." items={changing} programs={programs} labels={labels} canEdit={canEdit} />
          <Group title="Check the PDF" description="The original headers weren't kept (typed by hand, or edited since), so MPS HQ can't tell. Open one to look and change it under Grid settings." items={unsure} programs={programs} labels={labels} canEdit={canEdit} />
          <Group title="No change needed" description="Printed as ranges, or already read as maximums." items={fine} programs={programs} labels={labels} canEdit={canEdit} quiet />
        </>
      )}
    </div>
  )
}

function Group({ title, description, items, programs, labels, canEdit, quiet }: { title: string; description: string; items: TierReviewItem[]; programs: Map<string, CatalogProgram>; labels: Map<string, PrintedLabels>; canEdit: boolean; quiet?: boolean }) {
  if (items.length === 0) return null
  return (
    <Card title={`${title} (${items.length})`} description={description}>
      <ul className="divide-y">
        {items.map((item) => (
          <Item key={item.programId} item={item} program={programs.get(item.programId)} labels={labels.get(item.programId)} canEdit={canEdit} quiet={quiet} />
        ))}
      </ul>
    </Card>
  )
}

function Item({ item, program: current, labels, canEdit, quiet }: { item: TierReviewItem; program: CatalogProgram | undefined; labels: PrintedLabels | undefined; canEdit: boolean; quiet?: boolean }) {
  const { state } = useAuth()
  const navigate = useNavigate()
  const start = useStartTypedMatrix(item.lenderId)
  const [opening, setOpening] = useState(false)
  const [showAll, setShowAll] = useState(false)

  /** Opens the matrix in use as a draft with the proposed reading on its multi-tier grids; approving it there makes the new version. */
  const open = async () => {
    if (state.status !== 'signedIn' || !state.user.organizationId || !current) return
    setOpening(true)
    try {
      const { program, documentId } = await programAsReading(item.programId)
      // The matrix in use, re-read with the proposed settings exactly as this list checked it.
      const grids = gridsFromCells(withProposed(current, labels).program.cells, program.lien)
      const id = await start.mutateAsync({ organizationId: state.user.organizationId, documentId, program: { ...program, grids }, editOf: item.programId })
      navigate(`/admin/lenders/imports/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
      setOpening(false)
    }
  }

  const shown = showAll ? item.results : item.results.slice(0, 6)
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {item.lenderName} <span className="text-muted-foreground">·</span> {item.programName}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.grids.length} grid{item.grids.length === 1 ? '' : 's'} with loan-amount tiers
            {item.changes && ` · ${item.results.length} of ${item.checked} standard scenarios change`}
          </p>
        </div>
        {canEdit && !quiet && (
          <Button size="sm" variant={item.changes ? 'default' : 'outline'} disabled={opening} onClick={open}>
            {opening ? 'Opening…' : item.changes ? 'Review & approve' : 'Open to check'}
          </Button>
        )}
      </div>
      {!quiet && (
        <ul className="mt-2 space-y-2">
          {item.grids.map((g, i) => (
            <li key={i} className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">{g.title}</p>
              <p className="text-xs text-muted-foreground">Tiers: {g.tiers.join(' · ')}</p>
              <p className="mt-1">
                <span className="text-muted-foreground">Reads now:</span> {settingsText(g.current)}
              </p>
              {settingsText(g.proposed) !== settingsText(g.current) && (
                <p>
                  <span className="text-muted-foreground">Proposed:</span> <span className="font-medium">{settingsText(g.proposed)}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{g.basis}</p>
            </li>
          ))}
        </ul>
      )}
      {item.results.length > 0 && (
        <div className="mt-2 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Standard scenario</th>
                <th className="px-3 py-1.5 text-left font-medium">Max today</th>
                <th className="px-3 py-1.5 text-left font-medium">Max after</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => (
                <tr key={r.scenario}>
                  <td className="px-3 py-1.5">{r.scenario}</td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.before}</td>
                  <td className="px-3 py-1.5 font-medium tabular-nums">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {item.results.length > 6 && (
            <button type="button" className="w-full border-t px-3 py-1.5 text-left text-xs font-medium text-primary hover:underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${item.results.length}`}
            </button>
          )}
        </div>
      )}
    </li>
  )
}
