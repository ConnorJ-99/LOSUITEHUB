import { useState } from 'react'
import { toast } from 'sonner'
import { CurrencyInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useDeleteRow, useSaveRow, type ApplicationBorrower, type Asset, type Liability } from '@/lib/api/urla'
import { monthlyDebtPayments } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'
import { fullName } from '@/lib/pipeline/helpers'
import {
  ASSET_OPTIONS,
  GIFT_SOURCE_OPTIONS,
  isExpenseLiability,
  isGift,
  labelFor,
  LIABILITY_OPTIONS,
  type AssetType,
  type GiftSource,
  type LiabilityType,
} from '@/lib/urla/options'
import { AddButton, EditDialog, ListRow, SectionCard, SubHeading } from './parts'

const last4 = (v: string) => v.replace(/\D/g, '').slice(-4)

function OwnerFields({
  borrowers,
  contactId,
  isJoint,
  onContact,
  onJoint,
}: {
  borrowers: ApplicationBorrower[]
  contactId: string
  isJoint: boolean
  onContact: (id: string) => void
  onJoint: (v: boolean) => void
}) {
  if (borrowers.length < 2) return null
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-64">
        <Select
          label="Owner"
          value={contactId}
          onChange={onContact}
          options={borrowers.map((b) => ({ value: b.contactId, label: fullName(b.person) }))}
          required
        />
      </div>
      <ToggleChip label="Joint with co-borrower" pressed={isJoint} onChange={onJoint} />
    </div>
  )
}

const ownerLabel = (borrowers: ApplicationBorrower[], contactId: string, isJoint: boolean) => {
  if (borrowers.length < 2) return null
  if (isJoint) return 'Joint'
  const b = borrowers.find((x) => x.contactId === contactId)
  return b ? fullName(b.person) : null
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

type AssetForm = Omit<Asset, 'id' | 'loanId' | 'assetType' | 'amount'> & { assetType: AssetType | null; amount: number | null }

function AssetDialog({ loanId, organizationId, borrowers, asset, onClose }: { loanId: string; organizationId: string; borrowers: ApplicationBorrower[]; asset: Asset | null; onClose: () => void }) {
  const save = useSaveRow(loanId, organizationId, 'assets')
  const [form, setForm] = useState<AssetForm>(() =>
    asset ?? { contactId: borrowers[0].contactId, isJoint: false, assetType: null, institutionName: null, accountLast4: null, amount: null, giftSource: null, giftDeposited: null, description: null },
  )
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const gift = form.assetType ? isGift(form.assetType) : false

  const submit = () => {
    if (!form.assetType || form.amount === null) return toast.error('Choose a type and enter the amount')
    if (form.accountLast4 && form.accountLast4.length !== 4) return toast.error('Account number: enter the last 4 digits')
    save.mutate(
      { ...form, id: asset?.id, giftSource: gift ? form.giftSource : null, giftDeposited: gift ? form.giftDeposited : null },
      { onSuccess: onClose, onError: (e) => toast.error(`Could not save asset: ${e.message}`) },
    )
  }

  return (
    <EditDialog title={asset ? 'Edit asset' : 'Add asset'} open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={save.isPending}>
      <OwnerFields borrowers={borrowers} contactId={form.contactId} isJoint={form.isJoint} onContact={set('contactId')} onJoint={set('isJoint')} />
      <FormGrid className="lg:grid-cols-4">
        <Select label="Type" value={form.assetType} onChange={set('assetType')} options={ASSET_OPTIONS} required span={2} />
        <CurrencyInput label={gift ? 'Gift / grant amount' : 'Cash or market value'} value={form.amount} onChange={set('amount')} required span={2} />
        {gift ? (
          <Select<GiftSource> label="Source" value={form.giftSource} onChange={set('giftSource')} options={GIFT_SOURCE_OPTIONS} span={2} />
        ) : (
          <>
            <Input label="Financial institution" value={form.institutionName ?? ''} onChange={(v) => set('institutionName')(v || null)} span={2} />
            <Input label="Account (last 4)" inputMode="numeric" value={form.accountLast4 ?? ''} onChange={(v) => set('accountLast4')(last4(v) || null)} hint="Only the last 4 digits are stored" />
          </>
        )}
        <Input label="Notes" value={form.description ?? ''} onChange={(v) => set('description')(v || null)} span={4} />
      </FormGrid>
      {gift && (
        <ToggleChipGroup>
          <ToggleChip label="Deposited" pressed={form.giftDeposited === true} onChange={(p) => set('giftDeposited')(p ? true : null)} />
          <ToggleChip label="Not deposited" pressed={form.giftDeposited === false} onChange={(p) => set('giftDeposited')(p ? false : null)} />
        </ToggleChipGroup>
      )}
    </EditDialog>
  )
}

/** Sections 2a, 2b and 4d: accounts, other assets and credits, gifts and grants. */
export function AssetsSection({ loanId, organizationId, borrowers, assets }: { loanId: string; organizationId: string; borrowers: ApplicationBorrower[]; assets: Asset[] }) {
  const remove = useDeleteRow(loanId, 'assets')
  const [editing, setEditing] = useState<{ asset: Asset | null } | null>(null)
  const total = assets.reduce((s, a) => s + a.amount, 0)
  const groups = [
    { label: 'Accounts and other assets', items: assets.filter((a) => !isGift(a.assetType)) },
    { label: 'Gifts and grants', items: assets.filter((a) => isGift(a.assetType)) },
  ].filter((g) => g.items.length > 0)

  return (
    <SectionCard
      id="section-2"
      title="2a–2b, 4d. Assets, credits and gifts"
      description={assets.length ? `Total ${formatCurrency(total)}` : undefined}
      action={<AddButton label="Add asset" onClick={() => setEditing({ asset: null })} />}
    >
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assets yet: checking, savings, retirement, earnest money, gifts…</p>
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            {groups.length > 1 && <SubHeading>{g.label}</SubHeading>}
            <ul className="divide-y">
              {g.items.map((a) => (
                <ListRow
                  key={a.id}
                  title={labelFor(ASSET_OPTIONS, a.assetType)}
                  detail={[
                    a.institutionName,
                    a.accountLast4 && `••••${a.accountLast4}`,
                    a.giftSource && `from ${labelFor(GIFT_SOURCE_OPTIONS, a.giftSource).toLowerCase()}`,
                    a.giftDeposited === true ? 'deposited' : a.giftDeposited === false ? 'not deposited' : null,
                    ownerLabel(borrowers, a.contactId, a.isJoint),
                  ].filter(Boolean).join(' · ')}
                  amount={formatCurrency(a.amount)}
                  onEdit={() => setEditing({ asset: a })}
                  onDelete={() => remove.mutate(a.id, { onError: (e) => toast.error(e.message) })}
                />
              ))}
            </ul>
          </div>
        ))
      )}
      {editing && <AssetDialog loanId={loanId} organizationId={organizationId} borrowers={borrowers} asset={editing.asset} onClose={() => setEditing(null)} />}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Liabilities
// ---------------------------------------------------------------------------

type LiabilityForm = Omit<Liability, 'id' | 'loanId' | 'liabilityType' | 'monthlyPayment'> & { liabilityType: LiabilityType | null; monthlyPayment: number | null }

function LiabilityDialog({ loanId, organizationId, borrowers, liability, onClose }: { loanId: string; organizationId: string; borrowers: ApplicationBorrower[]; liability: Liability | null; onClose: () => void }) {
  const save = useSaveRow(loanId, organizationId, 'liabilities')
  const [form, setForm] = useState<LiabilityForm>(() =>
    liability ?? { contactId: borrowers[0].contactId, isJoint: false, liabilityType: null, creditorName: null, accountLast4: null, unpaidBalance: null, monthlyPayment: null, monthsRemaining: null, toBePaidOff: false, description: null },
  )
  const set = <K extends keyof LiabilityForm>(key: K) => (value: LiabilityForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const expense = form.liabilityType ? isExpenseLiability(form.liabilityType) : false

  const submit = () => {
    if (!form.liabilityType || form.monthlyPayment === null) return toast.error('Choose a type and enter the monthly payment')
    if (form.accountLast4 && form.accountLast4.length !== 4) return toast.error('Account number: enter the last 4 digits')
    save.mutate({ ...form, id: liability?.id }, { onSuccess: onClose, onError: (e) => toast.error(`Could not save: ${e.message}`) })
  }

  return (
    <EditDialog title={liability ? 'Edit liability' : 'Add liability'} description="Mortgages go on the property they're secured by (Real estate section)." open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={save.isPending}>
      <OwnerFields borrowers={borrowers} contactId={form.contactId} isJoint={form.isJoint} onContact={set('contactId')} onJoint={set('isJoint')} />
      <FormGrid className="lg:grid-cols-4">
        <Select label="Type" value={form.liabilityType} onChange={set('liabilityType')} options={LIABILITY_OPTIONS} required span={2} />
        <CurrencyInput label="Monthly payment" value={form.monthlyPayment} onChange={set('monthlyPayment')} required span={2} />
        {!expense && (
          <>
            <Input label="Creditor" value={form.creditorName ?? ''} onChange={(v) => set('creditorName')(v || null)} span={2} />
            <Input label="Account (last 4)" inputMode="numeric" value={form.accountLast4 ?? ''} onChange={(v) => set('accountLast4')(last4(v) || null)} />
            <Input
              label="Months left"
              inputMode="numeric"
              value={form.monthsRemaining?.toString() ?? ''}
              onChange={(v) => set('monthsRemaining')(v.trim() === '' ? null : Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0)))}
            />
            <CurrencyInput label="Unpaid balance" value={form.unpaidBalance} onChange={set('unpaidBalance')} span={2} />
          </>
        )}
        <Input label="Notes" value={form.description ?? ''} onChange={(v) => set('description')(v || null)} span={expense ? 4 : 2} />
      </FormGrid>
      {!expense && (
        <ToggleChipGroup>
          <ToggleChip label="Paid off at or before closing" pressed={form.toBePaidOff} onChange={set('toBePaidOff')} />
        </ToggleChipGroup>
      )}
    </EditDialog>
  )
}

/** Sections 2c and 2d: debts and other monthly obligations. */
export function LiabilitiesSection({ loanId, organizationId, borrowers, liabilities }: { loanId: string; organizationId: string; borrowers: ApplicationBorrower[]; liabilities: Liability[] }) {
  const remove = useDeleteRow(loanId, 'liabilities')
  const [editing, setEditing] = useState<{ liability: Liability | null } | null>(null)
  const monthly = monthlyDebtPayments(liabilities)

  return (
    <SectionCard
      id="section-2-liabilities"
      title="2c–2d. Liabilities and expenses"
      description={liabilities.length ? `${formatCurrency(monthly)}/mo after payoffs` : undefined}
      action={<AddButton label="Add liability" onClick={() => setEditing({ liability: null })} />}
    >
      {liabilities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No liabilities yet: credit cards, auto and student loans, alimony, child support…</p>
      ) : (
        <ul className="divide-y">
          {liabilities.map((l) => (
            <ListRow
              key={l.id}
              title={
                <>
                  {l.creditorName ?? labelFor(LIABILITY_OPTIONS, l.liabilityType)}
                  {l.toBePaidOff && <span className="ml-2 text-xs font-normal text-primary">Paid off at closing</span>}
                </>
              }
              detail={[
                l.creditorName && labelFor(LIABILITY_OPTIONS, l.liabilityType),
                l.accountLast4 && `••••${l.accountLast4}`,
                l.unpaidBalance !== null && `${formatCurrency(l.unpaidBalance)} balance`,
                l.monthsRemaining !== null && `${l.monthsRemaining} mo left`,
                ownerLabel(borrowers, l.contactId, l.isJoint),
              ].filter(Boolean).join(' · ')}
              amount={`${formatCurrency(l.monthlyPayment)}/mo`}
              onEdit={() => setEditing({ liability: l })}
              onDelete={() => remove.mutate(l.id, { onError: (e) => toast.error(e.message) })}
            />
          ))}
        </ul>
      )}
      {editing && <LiabilityDialog loanId={loanId} organizationId={organizationId} borrowers={borrowers} liability={editing.liability} onClose={() => setEditing(null)} />}
    </SectionCard>
  )
}
