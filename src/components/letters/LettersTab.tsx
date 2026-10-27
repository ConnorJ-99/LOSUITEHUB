import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, FileTextIcon, MailIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Card, CurrencyInput, DateInput, EmptyState, FormGrid, Select, TextArea, ToggleChip } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { keys } from '@/lib/api/client'
import { openDocument, useLoanDocuments } from '@/lib/api/documents'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import { issueLetter, linkLetterPdf, removeLetter, usePreapprovalLetters, useRemoveLetter } from '@/lib/api/preapproval'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { formatIsoDate, nowIso, todayIso } from '@/lib/dates'
import { joinNames, worksheetFileName } from '@/lib/documents/feeWorksheet'
import {
  firstLetter,
  letterProblems,
  letterView,
  newReference,
  nextVersion,
  offerLetter,
  PREAPPROVAL_TEMPLATE,
  REVIEWED_OPTIONS,
  type ApprovedMax,
  type LetterDraft,
  type SavedLetter,
} from '@/lib/documents/preapproval'
import { formatCurrency } from '@/lib/format'

const AMORTIZATION_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'arm', label: 'ARM' },
] as const

/** "100 Test Lane, Frisco, TX 75034". */
const homeAddress = (p: Property) => [p.addressLine, p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

interface Editing {
  draft: LetterDraft
  referenceNumber: string
  version: number
}

/** Letters (purchase files): the approved maximum, every pre-approval letter issued, and a new letter or version with a live preview. */
export function LettersTab({ loan }: { loan: LoanProfile }) {
  const letters = usePreapprovalLetters(loan.id)
  const properties = useProperties(loan.id)
  const app = useApplication(loan.id)
  const docs = useLoanDocuments(loan.id)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Editing | null>(null)
  const today = todayIso()
  const d = loan.details
  const max: ApprovedMax = { maxPrice: d.preapprovalMaxPrice, maxLoanAmount: d.preapprovalMaxLoanAmount, expiresOn: d.preapprovalExpiresOn }
  const list = letters.data ?? []
  const homes = properties.data ?? []

  const file = () => ({
    mortgageType: d.mortgageType,
    termMonths: d.termMonths,
    amortizationType: d.amortizationType,
    occupancy: d.occupancy,
    purchasePrice: d.purchasePrice,
    loanAmount: d.loanAmount,
    sellerCredits: d.sellerCredits,
    earnestMoney: (app.data?.assets ?? []).filter((a) => a.assetType === 'earnest_money').reduce((sum, a) => sum + a.amount, 0),
    documentKinds: (docs.data ?? []).map((x) => x.kind),
  })
  const startNew = () => setEditing({ draft: firstLetter(file(), max, today), referenceNumber: newReference(loan.id, today), version: 1 })
  /** A new version of the latest pre-approval for this home (or a new pre-approval if there's none yet). */
  const startOffer = (home: Property) => {
    const latest = list[0]
    const base = latest ?? firstLetter(file(), max, today)
    const referenceNumber = latest?.referenceNumber ?? newReference(loan.id, today)
    setEditing({ draft: offerLetter(base, { id: home.id, address: homeAddress(home), price: home.listPrice }, max, today), referenceNumber, version: nextVersion(list, referenceNumber) })
  }

  // "Pre-approval letter" on a property card opens here with ?property=<id>.
  const wantedHome = params.get('property')
  const ready = letters.isSuccess && properties.isSuccess && app.isSuccess && docs.isSuccess
  const [seenHome, setSeenHome] = useState<string | null>(null)
  if (ready && wantedHome && wantedHome !== seenHome) {
    setSeenHome(wantedHome)
    const home = homes.find((h) => h.id === wantedHome)
    if (home) startOffer(home)
  }
  const closeEditor = () => {
    setEditing(null)
    setSeenHome(null)
    if (wantedHome)
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('property')
          return next
        },
        { replace: true },
      )
  }

  if (letters.isLoading || properties.isLoading || app.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (letters.error) return <p className="py-12 text-center text-sm text-destructive">{letters.error.message.includes('preapproval_letters') ? 'Run the pre-approval letters script in Supabase to use Letters.' : letters.error.message}</p>

  const borrowerNames = (app.data?.borrowers ?? []).map((b) => `${b.person.firstName} ${b.person.lastName}`)
  const subject = homes.find((h) => h.id === d.subjectPropertyId) ?? null
  const place = subject ? [subject.city, subject.state].filter(Boolean).join(', ') || null : null

  return (
    <div className="space-y-4">
      <ApprovedMaxCard loan={loan} max={max} />

      {editing ? (
        <LetterEditor key={`${editing.referenceNumber}-${editing.version}`} loan={loan} editing={editing} max={max} homes={homes} borrowerNames={borrowerNames} place={place} onDone={closeEditor} />
      ) : (
        <Card
          title="Pre-approval letters"
          description="Each letter is kept exactly as issued. Make a new version for an offer on a home; it can't go over the approved maximum."
          action={
            <div className="flex flex-wrap gap-2">
              {homes.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      New version for an offer
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {homes.map((h) => (
                      <DropdownMenuItem key={h.id} onSelect={() => startOffer(h)}>
                        {h.addressLine}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button size="sm" variant={list.length ? 'outline' : 'default'} onClick={startNew}>
                <PlusIcon />
                {list.length ? 'New pre-approval' : 'First letter'}
              </Button>
            </div>
          }
        >
          {list.length === 0 ? (
            <EmptyState icon={MailIcon} title="No letters yet" description="Set the approved maximum, then make the first letter: “up to” the maximum, with no address yet." />
          ) : (
            <ul className="divide-y">
              {list.map((l) => (
                <LetterRow key={l.id} loan={loan} letter={l} documentName={docs.data?.find((x) => x.id === l.documentId)?.fileName ?? null} onOpen={() => {
                  const doc = docs.data?.find((x) => x.id === l.documentId)
                  if (doc) openDocument(doc).catch((e: Error) => toast.error(e.message))
                }} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function LetterRow({ loan, letter: l, documentName, onOpen }: { loan: LoanProfile; letter: SavedLetter; documentName: string | null; onOpen: () => void }) {
  const remove = useRemoveLetter(loan.id)
  const expired = l.expiresOn < todayIso()
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <Badge variant="secondary">v{l.version}</Badge>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {l.propertyAddress ?? 'Up to, no address'} · {formatCurrency(l.purchasePrice)}
        </p>
        <p className="text-xs text-muted-foreground">
          #{l.referenceNumber} · issued {formatIsoDate(l.issuedOn)} · {expired ? <span className="text-destructive">expired {formatIsoDate(l.expiresOn)}</span> : `expires ${formatIsoDate(l.expiresOn)}`}
        </p>
      </div>
      {documentName ? (
        <Button size="sm" variant="ghost" onClick={onOpen}>
          <FileTextIcon />
          Open PDF
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">PDF deleted</span>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Remove letter"
        disabled={remove.isPending}
        onClick={() => window.confirm(`Remove v${l.version} from the list? Only do this for a letter made by mistake. Its PDF stays in Documents.`) && remove.mutate(l.id, { onError: (e) => toast.error(e.message) })}
      >
        <Trash2Icon />
      </Button>
    </li>
  )
}

function ApprovedMaxCard({ loan, max }: { loan: LoanProfile; max: ApprovedMax }) {
  const update = useUpdateLoanDetails(loan.id)
  const [form, setForm] = useState(max)
  const dirty = form.maxPrice !== max.maxPrice || form.maxLoanAmount !== max.maxLoanAmount || form.expiresOn !== max.expiresOn
  const save = () => {
    if (form.maxPrice != null && form.maxLoanAmount != null && form.maxLoanAmount > form.maxPrice) return toast.error('The maximum loan amount is more than the maximum price.')
    update.mutate({ preapprovalMaxPrice: form.maxPrice, preapprovalMaxLoanAmount: form.maxLoanAmount, preapprovalExpiresOn: form.expiresOn }, { onSuccess: () => toast.success('Approved maximum saved'), onError: (e) => toast.error(e.message) })
  }
  const notSet = max.maxPrice == null || max.maxLoanAmount == null
  return (
    <Card title="Approved maximum" description={notSet ? 'What this borrower is approved for. Every letter is checked against it.' : 'Every letter is checked against this. Changing it does not change letters already issued.'}>
      <FormGrid className="items-end">
        <CurrencyInput label="Max purchase price" value={form.maxPrice} onChange={(v) => setForm({ ...form, maxPrice: v })} required span={2} />
        <CurrencyInput label="Max loan amount" value={form.maxLoanAmount} onChange={(v) => setForm({ ...form, maxLoanAmount: v })} required span={2} />
        <DateInput label="Pre-approval expires" value={form.expiresOn} onChange={(v) => setForm({ ...form, expiresOn: v })} hint="Blank = 90 days per letter" />
        <div className="pb-0.5">
          <Button onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </FormGrid>
    </Card>
  )
}

function LetterEditor({ loan, editing, max, homes, borrowerNames, place, onDone }: { loan: LoanProfile; editing: Editing; max: ApprovedMax; homes: Property[]; borrowerNames: string[]; place: string | null; onDone: () => void }) {
  const [draft, setDraft] = useState(editing.draft)
  const [conditions, setConditions] = useState(editing.draft.extraConditions.join('\n'))
  const [preview, setPreview] = useState<{ url: string } | { error: string } | null>(null)
  const [issuing, setIssuing] = useState(false)
  const pdf = useSavePdf(loan)
  const queryClient = useQueryClient()
  const set = <K extends keyof LetterDraft>(key: K) => (value: LetterDraft[K]) => setDraft((x) => ({ ...x, [key]: value }))
  const full: LetterDraft = { ...draft, extraConditions: conditions.split('\n') }
  const view = letterView(full, editing.referenceNumber, editing.version, borrowerNames, place)
  const problems = letterProblems(full, max, todayIso())

  // Live preview, redrawn shortly after typing stops.
  const latest = useRef(0)
  const viewKey = JSON.stringify(view)
  const redraw = useEffectEvent(async (n: number) => {
    const result = await pdf.preview((lib, brand) => lib.preapprovalLetterPdf(view, brand))
    if (n === latest.current) setPreview((old) => (old && 'url' in old && URL.revokeObjectURL(old.url), result))
  })
  useEffect(() => {
    if (!pdf.ready) return
    const n = ++latest.current
    const timer = setTimeout(() => redraw(n), 700)
    return () => clearTimeout(timer)
  }, [viewKey, pdf.ready])

  const pickHome = (id: string | null) => {
    const home = homes.find((h) => h.id === id)
    // The down payment percent comes from the approved maximum, so switching homes back and forth never drifts.
    setDraft((x) => {
      if (!home) return { ...x, propertyId: null, propertyAddress: null }
      const base = { ...x, purchasePrice: max.maxPrice ?? x.purchasePrice, loanAmount: max.maxLoanAmount ?? x.loanAmount }
      return { ...offerLetter(base, { id: home.id, address: homeAddress(home), price: home.listPrice }, max, x.issuedOn), expiresOn: x.expiresOn }
    })
  }

  const issue = async () => {
    if (problems.length) return toast.error(problems[0])
    setIssuing(true)
    let letterId: string | null = null
    try {
      letterId = await issueLetter(loan.id, loan.organizationId, full, editing.referenceNumber, editing.version)
      const docId = await pdf.save({
        render: (lib, brand) => lib.preapprovalLetterPdf(view, brand),
        tooLong: 'Shorten the conditions or what was reviewed.',
        fileName: worksheetFileName(`Pre-Approval Letter v${editing.version}`, joinNames(borrowerNames), nowIso()),
        kind: 'preapproval_letter',
        propertyId: full.propertyId,
        templateVersion: PREAPPROVAL_TEMPLATE,
      })
      if (!docId) {
        // The PDF wasn't made (the reason is shown), so the letter wasn't issued.
        await removeLetter(letterId)
        return
      }
      await linkLetterPdf(letterId, docId)
      await queryClient.invalidateQueries({ queryKey: keys.preapprovalLetters(loan.id) })
      onDone()
    } catch (e) {
      if (letterId) await removeLetter(letterId).catch(() => {})
      toast.error((e as Error).message)
    } finally {
      setIssuing(false)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Card
        title={`${draft.propertyAddress ? 'Letter for an offer' : 'Pre-approval letter'} · v${editing.version}`}
        description={`Reference #${editing.referenceNumber}. These changes are for this letter only; the loan isn't changed.`}
        action={
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        }
      >
        <div className="space-y-4">
          <FormGrid className="lg:grid-cols-2">
            <Select label="Property" value={draft.propertyId} options={homes.map((h) => ({ value: h.id, label: h.addressLine }))} onChange={pickHome} onClear={() => pickHome(null)} placeholder="None yet (up to)" span={2} />
            <CurrencyInput label={draft.propertyAddress ? 'Purchase price' : 'Purchase price up to'} value={draft.purchasePrice} onChange={set('purchasePrice')} required hint={max.maxPrice != null ? `Max ${formatCurrency(max.maxPrice)}` : undefined} />
            <CurrencyInput label="Loan amount up to" value={draft.loanAmount} onChange={set('loanAmount')} required hint={max.maxLoanAmount != null ? `Max ${formatCurrency(max.maxLoanAmount)}` : undefined} />
            <Select label="Loan type" value={draft.mortgageType} options={MORTGAGE_TYPE_OPTIONS} onChange={set('mortgageType')} required />
            <Select label="Term" value={draft.termMonths ? String(draft.termMonths) : null} options={TERM_OPTIONS} onChange={(v) => set('termMonths')(Number(v))} required />
            <Select label="Amortization" value={draft.amortizationType} options={AMORTIZATION_OPTIONS} onChange={set('amortizationType')} />
            <Select label="Occupancy" value={draft.occupancy} options={OCCUPANCY_OPTIONS} onChange={set('occupancy')} />
            <CurrencyInput label="Seller credits" value={draft.sellerCredits} onChange={set('sellerCredits')} />
            <CurrencyInput label="Earnest money" value={draft.earnestMoney} onChange={set('earnestMoney')} />
            <DateInput label="Issued" value={draft.issuedOn} readOnly />
            <DateInput label="Expires" value={draft.expiresOn} onChange={(v) => v && set('expiresOn')(v)} required />
          </FormGrid>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Show on the letter</p>
            <div className="flex flex-wrap gap-1.5">
              <ToggleChip label="Seller credits" pressed={draft.showSellerCredits} onChange={set('showSellerCredits')} disabled={!draft.sellerCredits} />
              <ToggleChip label="Earnest money" pressed={draft.showEarnestMoney} onChange={set('showEarnestMoney')} disabled={!draft.earnestMoney} />
              <ToggleChip label="Down payment" pressed={draft.showDownPayment} onChange={set('showDownPayment')} />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">What we have reviewed</p>
            <div className="flex flex-wrap gap-1.5">
              {REVIEWED_OPTIONS.map((o) => (
                <ToggleChip key={o} label={o} pressed={draft.reviewed.includes(o)} onChange={(on) => set('reviewed')(REVIEWED_OPTIONS.filter((x) => (x === o ? on : draft.reviewed.includes(x))))} />
              ))}
            </div>
          </div>

          <TextArea label="Extra conditions (one per line)" value={conditions} onChange={setConditions} rows={3} hint="Added after the four standard conditions, e.g. “sale of 12 Old St”." />

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <Button onClick={issue} disabled={issuing || pdf.saving || !pdf.ready || problems.length > 0}>
              <FileTextIcon />
              {issuing ? 'Issuing…' : `Issue v${editing.version} and save PDF`}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Preview" description="Exactly what the borrower gets.">
        {!preview ? (
          <p className="py-24 text-center text-sm text-muted-foreground">Drawing the letter…</p>
        ) : 'error' in preview ? (
          <p className="py-24 text-center text-sm text-destructive">{preview.error}</p>
        ) : (
          <PdfPage url={preview.url} />
        )}
      </Card>
    </div>
  )
}

/** The PDF's page drawn on a canvas, so the preview works in every browser (some can't show a PDF inside a page). */
function PdfPage({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!box.current || !canvas.current) return
    import('@/lib/documents/pdfText').then(({ drawFirstPage }) => drawFirstPage(url, canvas.current!, box.current!.clientWidth)).catch(() => {})
  }, [url])
  return (
    <div ref={box} className="w-full overflow-hidden rounded-md border shadow-sm">
      <canvas ref={canvas} aria-label="Letter preview" className="block" />
    </div>
  )
}
