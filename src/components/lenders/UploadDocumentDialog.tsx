import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useUploadGuidelineDocument, type LenderDocument, type LenderProgram } from '@/lib/api/lenders'
import type { GuidelineDocument } from '@/lib/api/products'

const DOC_TYPE_OPTIONS: { value: GuidelineDocument['docType']; label: string }[] = [
  { value: 'matrix', label: 'Matrix' },
  { value: 'guidelines', label: 'Guidelines' },
  { value: 'overlay_bulletin', label: 'Overlay bulletin' },
  { value: 'rate_sheet', label: 'Rate sheet' },
]

/** Upload a lender PDF: it's stored privately, its text is split into searchable passages (no AI), and it's linked to programs. */
export function UploadDocumentDialog({ lenderId, programs, documents, onClose }: { lenderId: string; programs: LenderProgram[]; documents: LenderDocument[]; onClose: () => void }) {
  const upload = useUploadGuidelineDocument(lenderId)
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<GuidelineDocument['docType']>('guidelines')
  const [title, setTitle] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null)
  const [programIds, setProgramIds] = useState<string[]>([])
  const [replacesId, setReplacesId] = useState<string | null>(null)
  const replaceable = documents.filter((d) => d.current && d.docType === docType)

  const submit = () => {
    if (!file) return toast.error('Pick a PDF first.')
    upload.mutate(
      { lenderId, file, docType, title: title || file.name.replace(/\.pdf$/i, ''), versionLabel: versionLabel || null, effectiveDate, programIds, replacesId },
      {
        onSuccess: ({ pages, passages }) => {
          if (passages === 0) toast.warning(`Saved, but no text was found in the ${pages} pages. It looks like a scanned PDF, so text search won't find anything in it.`)
          else toast.success(`Saved: ${pages} pages, ${passages} searchable passages`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !upload.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload a lender document</DialogTitle>
          <DialogDescription>Matrix PDFs, full guidelines or overlay bulletins. The text is split into sections you can search; no AI is used. Matrices are turned into searchable cells in the import step.</DialogDescription>
        </DialogHeader>
        <div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setFile(f)
              if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''))
            }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <FormGrid className="lg:grid-cols-4">
          <Select label="Type" value={docType} options={DOC_TYPE_OPTIONS} onChange={setDocType} />
          <Input label="Title" value={title} onChange={setTitle} span={3} />
          <Input label="Version" value={versionLabel} onChange={setVersionLabel} placeholder="rev. 09/2026" span={2} />
          <DateInput label="Effective date" value={effectiveDate} onChange={setEffectiveDate} span={2} />
          {replaceable.length > 0 && (
            <Select label="Replaces" value={replacesId} options={replaceable.map((d) => ({ value: d.id, label: `${d.title}${d.versionLabel ? ` (${d.versionLabel})` : ''}` }))} onChange={setReplacesId} onClear={() => setReplacesId(null)} placeholder="Nothing (a new document)" span={4} />
          )}
        </FormGrid>
        {programs.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Programs this covers</p>
            <ToggleChipGroup>
              {programs.map((p) => (
                <ToggleChip key={p.id} label={p.name} pressed={programIds.includes(p.id)} onChange={(on) => setProgramIds((ids) => (on ? [...ids, p.id] : ids.filter((x) => x !== p.id)))} />
              ))}
            </ToggleChipGroup>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={upload.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={upload.isPending || !file}>
            {upload.isPending ? 'Reading and saving…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
