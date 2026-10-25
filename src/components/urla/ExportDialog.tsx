import { CircleCheckIcon, DownloadIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Organization, Profile } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { todayIso } from '@/lib/dates'
import { downloadText } from '@/lib/download'
import { buildMismo34 } from '@/lib/mismo/build'
import { exportChecklist, exportFileName } from '@/lib/mismo/checklist'

/** Pre-export checklist and download of the MISMO 3.4 file for Arive. */
export function ExportDialog({
  loan,
  application,
  properties,
  organization,
  originator,
  onClose,
}: {
  loan: LoanProfile
  application: Application
  properties: Property[]
  organization: Organization | null
  originator: Profile | null
  onClose: () => void
}) {
  const items = exportChecklist({ loan, application, properties, organization, originator })
  const areas = [...new Set(items.map((i) => i.area))]
  const primary = application.borrowers.find((b) => b.role === 'primary') ?? application.borrowers[0]

  const download = () => {
    const xml = buildMismo34({ createdAt: new Date().toISOString(), loan, application, properties, organization, originator })
    downloadText(exportFileName(primary?.person.lastName, todayIso()), xml)
    toast.success('MISMO 3.4 file downloaded. Import it in Arive.')
    onClose()
  }

  const goTo = (section: string) => {
    onClose()
    setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export MISMO 3.4 for Arive</DialogTitle>
          <DialogDescription>Downloads a Fannie Mae ULAD (MISMO v3.4) file you can import into Arive.</DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2.5 text-sm">
            <CircleCheckIcon className="size-4 shrink-0 text-primary" />
            Everything on the checklist is filled in.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {items.length} item{items.length === 1 ? '' : 's'} missing. You can still export and finish them in Arive.
            </p>
            {areas.map((area) => (
              <div key={area}>
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{area}</p>
                <ul className="divide-y rounded-lg border">
                  {items
                    .filter((i) => i.area === area)
                    .map((i) => (
                      <li key={i.message} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                        <span>{i.message}</span>
                        <Button size="xs" variant="ghost" onClick={() => goTo(i.section)}>
                          Fix
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
          No Social Security numbers are included (LOSuite doesn't store them). Add each borrower's SSN in Arive after importing.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={download}>
            <DownloadIcon />
            {items.length ? 'Export anyway' : 'Download file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
