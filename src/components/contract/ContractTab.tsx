import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, FileTextIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, EmptyState, FormGrid, Select } from '@/components/shared'
import { SectionCard, YesNo } from '@/components/urla/parts'
import { ContractFollowThrough } from './ContractFollowThrough'
import { ContractReadingCard } from './ContractReadingCard'
import { useDraft } from '@/components/urla/useDraft'
import {
  ACCEPTED_TYPES,
  DOCUMENT_KIND_LABEL,
  openDocument,
  useDeleteDocument,
  useLoanDocuments,
  useUpdateDocumentKind,
  useUploadDocument,
  type DocumentKind,
  type LoanDocument,
} from '@/lib/api/documents'
import { keys } from '@/lib/api/client'
import { saveEarnestMoney } from '@/lib/api/contract'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import { useProperties } from '@/lib/api/properties'
import type { ContractParty, LoanDetails, LoanProfile, PossessionTerms } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { contractFlags, type ContractFlag } from '@/lib/contract/flags'
import { formatIsoDate } from '@/lib/dates'
import { applicationSummary } from '@/lib/urla/summary'

const CONTRACT_KINDS: DocumentKind[] = ['purchase_contract', 'contract_addendum']
const KIND_OPTIONS = (Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]).map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] }))
const PAID_BY_OPTIONS: { value: ContractParty; label: string }[] = [
  { value: 'seller', label: 'Seller' },
  { value: 'buyer', label: 'Buyer' },
]
const POSSESSION_OPTIONS: { value: PossessionTerms; label: string }[] = [
  { value: 'closing_and_funding', label: 'At closing and funding' },
  { value: 'temporary_lease', label: 'Temporary lease' },
]

const sizeLabel = (bytes: number | null) => (bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** The executed contract and addenda: upload, open, relabel, delete. */
function ContractDocuments({ loan }: { loan: LoanProfile }) {
  const docs = useLoanDocuments(loan.id, CONTRACT_KINDS)
  const upload = useUploadDocument(loan.id, loan.organizationId)
  const relabel = useUpdateDocumentKind(loan.id)
  const remove = useDeleteDocument(loan.id)
  const input = useRef<HTMLInputElement>(null)
  const list = docs.data ?? []

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    // The first file on a file without a contract is the contract; the rest are addenda.
    let hasContract = list.some((d) => d.kind === 'purchase_contract')
    for (const file of Array.from(files)) {
      const kind: DocumentKind = hasContract ? 'contract_addendum' : 'purchase_contract'
      hasContract = true
      try {
        await upload.mutateAsync({ file, kind })
        toast.success(`Uploaded ${file.name}`)
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
    if (input.current) input.current.value = ''
  }

  const del = (doc: LoanDocument) => {
    if (!window.confirm(`Delete ${doc.fileName}? The file is removed from LOSuite.`)) return
    remove.mutate(doc, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card
      title="Contract documents"
      description="The executed contract and its addenda. Only people who can see this file can open them."
      action={
        <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <UploadIcon />
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      }
    >
      <input ref={input} type="file" className="hidden" accept={ACCEPTED_TYPES.join(',')} multiple onChange={(e) => add(e.target.files)} />
      {docs.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.isError ? (
        <p className="text-sm text-destructive">{docs.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={FileTextIcon} title="No contract uploaded yet" description="Upload the executed contract (PDF or photos, up to 25 MB each). Reading it with the assistant comes next." />
      ) : (
        <ul className="divide-y">
          {list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-primary hover:underline"
                onClick={() => openDocument(d).catch((e: Error) => toast.error(e.message))}
              >
                {d.fileName}
              </button>
              <span className="text-xs text-muted-foreground">
                {sizeLabel(d.sizeBytes)} · {formatIsoDate(d.createdAt.slice(0, 10))}
              </span>
              <div className="w-40">
                <Select
                  label="Kind"
                  value={d.kind}
                  options={KIND_OPTIONS}
                  onChange={(kind) => relabel.mutate({ id: d.id, kind }, { onError: (e) => toast.error(e.message) })}
                />
              </div>
              <Button size="xs" variant="ghost" onClick={() => del(d)} disabled={remove.isPending}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function FlagList({ flags, ready }: { flags: ContractFlag[]; ready: boolean }) {
  return (
    <Card title="Checks" description="The contract compared with the rest of the file.">
      {flags.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2Icon className={cn('size-4', ready && 'text-emerald-600')} />
          {ready ? 'Nothing on the contract conflicts with the file.' : 'Fill in the contract terms to run the checks.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {flags.map((f) => (
            <li key={f.key} className={cn('flex gap-2 rounded-lg border p-3 text-sm', f.tone === 'red' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">{f.title}</p>
                <p>{f.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

type TermsForm = Pick<
  LoanDetails,
  | 'purchasePrice'
  | 'contractDate'
  | 'optionEndDate'
  | 'closingDate'
  | 'optionFee'
  | 'contractFinancingAmount'
  | 'financingDeadline'
  | 'surveyDeadline'
  | 'sellerCredits'
  | 'titlePolicyPaidBy'
  | 'possession'
  | 'hasHoaAddendum'
> & { earnestMoney: number | null }

const TERM_KEYS = [
  'purchasePrice',
  'contractDate',
  'optionEndDate',
  'closingDate',
  'optionFee',
  'contractFinancingAmount',
  'financingDeadline',
  'surveyDeadline',
  'sellerCredits',
  'titlePolicyPaidBy',
  'possession',
  'hasHoaAddendum',
] as const

/**
 * The Contract section of a purchase file: the uploaded contract, its terms
 * and the checks against the file. Every term saves to the one place it
 * lives (the loan, or the 1003's earnest money asset), so the Overview and
 * 1003 show the same values.
 */
export function ContractTab({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  if (!app.data || !properties.data) return <p className="text-sm text-muted-foreground">Loading…</p>
  const earnest = app.data.assets.filter((a) => a.assetType === 'earnest_money')
  const saved: TermsForm = {
    ...(Object.fromEntries(TERM_KEYS.map((k) => [k, loan.details[k]])) as Omit<TermsForm, 'earnestMoney'>),
    earnestMoney: earnest.length ? earnest.reduce((s, a) => s + a.amount, 0) : null,
  }
  // Remount after a save so the form starts from what was saved.
  return <ContractTerms key={JSON.stringify(saved)} loan={loan} saved={saved} />
}

function ContractTerms({ loan, saved }: { loan: LoanProfile; saved: TermsForm }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const update = useUpdateLoanDetails(loan.id)
  const queryClient = useQueryClient()
  const [savingEarnest, setSavingEarnest] = useState(false)
  const { form, set, changes, dirty, reset } = useDraft<TermsForm>(saved)

  const application = app.data!
  const summary = applicationSummary(loan, application, properties.data)
  const propertyAddress = summary.subject ? [summary.subject.addressLine, summary.subject.city, [summary.subject.state, summary.subject.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : null
  const docs = useLoanDocuments(loan.id, CONTRACT_KINDS)
  const flags = contractFlags({
    mortgageType: loan.details.mortgageType,
    occupancy: loan.details.occupancy,
    purchasePrice: form.purchasePrice,
    loanAmount: loan.details.loanAmount,
    contractFinancingAmount: form.contractFinancingAmount,
    sellerCredits: form.sellerCredits,
    propertyValue: summary.subject?.estimatedValue ?? null,
    contractDate: form.contractDate,
    optionEndDate: form.optionEndDate,
    financingDeadline: form.financingDeadline,
    surveyDeadline: form.surveyDeadline,
    closingDate: form.closingDate,
    dti: summary.qualifying.dti.back,
  })

  const save = async () => {
    const { earnestMoney, ...loanChanges } = changes
    try {
      if (Object.keys(loanChanges).length) await update.mutateAsync(loanChanges)
      if ('earnestMoney' in changes) {
        setSavingEarnest(true)
        try {
          await saveEarnestMoney(loan.id, application, earnestMoney ?? null)
        } finally {
          setSavingEarnest(false)
          queryClient.invalidateQueries({ queryKey: keys.application(loan.id) })
        }
      }
      toast.success('Contract terms saved')
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`)
    }
  }
  const saving = update.isPending || savingEarnest
  const anyTerms = TERM_KEYS.some((k) => form[k] !== null) || form.earnestMoney !== null

  return (
    <div className="space-y-4">
      <ContractDocuments loan={loan} />
      <ContractReadingCard
        loan={loan}
        app={application}
        hasDocuments={(docs.data ?? []).length > 0}
        now={{ details: loan.details, earnestMoney: saved.earnestMoney, propertyAddress }}
      />
      <FlagList flags={flags} ready={anyTerms} />
      <SectionCard
        id="contract-terms"
        title="Contract terms"
        description="Same values as the Overview and 1003 (sales price, dates, seller credits, earnest money)."
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={reset}
      >
        <FormGrid>
          <CurrencyInput label="Sales price" value={form.purchasePrice} onChange={set('purchasePrice')} span={2} />
          <DateInput label="Effective date" value={form.contractDate} onChange={set('contractDate')} span={2} />
          <DateInput label="Closing date" value={form.closingDate} onChange={set('closingDate')} span={2} />
          <CurrencyInput label="Earnest money" value={form.earnestMoney} onChange={set('earnestMoney')} hint="Saved as the 1003's earnest money asset" span={2} />
          <CurrencyInput label="Option fee" value={form.optionFee} onChange={set('optionFee')} span={2} />
          <DateInput label="Option period ends" value={form.optionEndDate} onChange={set('optionEndDate')} span={2} />
          <CurrencyInput label="Financing amount (contract)" value={form.contractFinancingAmount} onChange={set('contractFinancingAmount')} hint="From the Third Party Financing addendum" span={2} />
          <DateInput label="Financing approval deadline" value={form.financingDeadline} onChange={set('financingDeadline')} span={2} />
          <DateInput label="Survey deadline" value={form.surveyDeadline} onChange={set('surveyDeadline')} span={2} />
          <CurrencyInput label="Seller concessions" value={form.sellerCredits} onChange={set('sellerCredits')} hint="Same as the 1003's seller credits" span={2} />
          <Select label="Title policy paid by" value={form.titlePolicyPaidBy} onChange={set('titlePolicyPaidBy')} onClear={() => set('titlePolicyPaidBy')(null)} options={PAID_BY_OPTIONS} span={2} />
          <Select label="Possession" value={form.possession} onChange={set('possession')} onClear={() => set('possession')(null)} options={POSSESSION_OPTIONS} span={2} />
        </FormGrid>
        <YesNo label="Mandatory HOA (HOA addendum attached)" value={form.hasHoaAddendum} onChange={set('hasHoaAddendum')} />
      </SectionCard>
      <ContractFollowThrough loan={loan} app={application} propertyAddress={propertyAddress} />
    </div>
  )
}
