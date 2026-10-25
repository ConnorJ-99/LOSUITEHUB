import { useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { CurrencyInput, FormGrid, Input, Select } from '@/components/shared'
import { useDeleteRow, useSaveRow, type Address, type ApplicationBorrower } from '@/lib/api/urla'
import { joinMonths, splitMonths } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { ADDRESS_KIND_OPTIONS, HOUSING_OPTIONS, labelFor, type AddressKind } from '@/lib/urla/options'
import { AddButton, EditDialog, ListRow, SectionCard } from './parts'

type AddressForm = Omit<Address, 'id' | 'contactId'> & { years: string; months: string }

function blankAddress(kind: AddressKind): AddressForm {
  return { kind, addressLine: '', unit: null, city: null, state: 'TX', zip: null, country: 'US', housing: null, monthlyRent: null, monthsAtAddress: null, years: '', months: '' }
}

function describeTime(months: number | null) {
  if (months === null) return null
  const { years, months: m } = splitMonths(months)
  return `${years} yr ${m} mo`
}

function AddressDialog({
  loanId,
  organizationId,
  contactId,
  address,
  defaultKind,
  usedKinds,
  onClose,
}: {
  loanId: string
  organizationId: string
  contactId: string
  address: Address | null
  defaultKind: AddressKind
  usedKinds: AddressKind[]
  onClose: () => void
}) {
  const save = useSaveRow(loanId, organizationId, 'contact_addresses')
  const [form, setForm] = useState<AddressForm>(() =>
    address ? { ...address, ...splitMonths(address.monthsAtAddress) } : blankAddress(defaultKind),
  )
  const set = <K extends keyof AddressForm>(key: K) => (value: AddressForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  // Only one current and one mailing address; former can repeat.
  const kindOptions = ADDRESS_KIND_OPTIONS.filter((o) => o.value === 'former' || o.value === address?.kind || !usedKinds.includes(o.value))

  const submit = () => {
    if (!form.addressLine.trim()) return toast.error('Street address is required')
    const { years, months, ...rest } = form
    save.mutate(
      {
        ...rest,
        id: address?.id,
        contactId,
        state: rest.state ? rest.state.toUpperCase() : null,
        monthsAtAddress: joinMonths(years, months),
        housing: rest.kind === 'mailing' ? null : rest.housing,
        monthlyRent: rest.housing === 'rent' ? rest.monthlyRent : null,
      },
      { onSuccess: onClose, onError: (e) => toast.error(`Could not save address: ${e.message}`) },
    )
  }

  return (
    <EditDialog title={address ? 'Edit address' : 'Add address'} open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={save.isPending}>
      <FormGrid>
        <Select label="Type" value={form.kind} onChange={set('kind')} options={kindOptions} required span={2} />
        <Input label="Street address" value={form.addressLine} onChange={set('addressLine')} required span={4} />
        <Input label="Unit" value={form.unit ?? ''} onChange={(v) => set('unit')(v || null)} />
        <Input label="City" value={form.city ?? ''} onChange={(v) => set('city')(v || null)} span={2} />
        <Input label="State" value={form.state ?? ''} onChange={(v) => set('state')(v.toUpperCase().slice(0, 2) || null)} />
        <Input label="ZIP" value={form.zip ?? ''} onChange={(v) => set('zip')(v || null)} inputMode="numeric" span={2} />
        {form.kind !== 'mailing' && (
          <>
            <Input label="Years there" inputMode="numeric" value={form.years} onChange={set('years')} />
            <Input label="Months" inputMode="numeric" value={form.months} onChange={set('months')} />
            <Select label="Housing" value={form.housing} onChange={set('housing')} options={HOUSING_OPTIONS} span={2} />
            {form.housing === 'rent' && <CurrencyInput label="Monthly rent" value={form.monthlyRent} onChange={set('monthlyRent')} span={2} />}
          </>
        )}
      </FormGrid>
    </EditDialog>
  )
}

/** Current, former (when under 2 years at current) and mailing addresses. */
export function AddressesSection({ loanId, organizationId, borrower }: { loanId: string; organizationId: string; borrower: ApplicationBorrower }) {
  const remove = useDeleteRow(loanId, 'contact_addresses')
  const [editing, setEditing] = useState<{ address: Address | null; kind: AddressKind } | null>(null)
  const current = borrower.addresses.find((a) => a.kind === 'current')
  const hasFormer = borrower.addresses.some((a) => a.kind === 'former')
  const needsFormer = current?.monthsAtAddress != null && current.monthsAtAddress < 24 && !hasFormer
  const usedKinds = borrower.addresses.map((a) => a.kind)

  return (
    <SectionCard
      id="section-1-addresses"
      title="Addresses"
      action={<AddButton label="Add address" onClick={() => setEditing({ address: null, kind: current ? 'former' : 'current' })} />}
    >
      {borrower.addresses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No addresses yet. Add the current address first.</p>
      ) : (
        <ul className="divide-y">
          {borrower.addresses.map((a) => (
            <ListRow
              key={a.id}
              title={
                <>
                  <span className="mr-2 text-xs font-semibold text-muted-foreground uppercase">{labelFor(ADDRESS_KIND_OPTIONS, a.kind).replace(' address', '')}</span>
                  {a.addressLine}
                  {a.unit && ` #${a.unit}`}
                </>
              }
              detail={[
                [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                describeTime(a.monthsAtAddress),
                a.housing && labelFor(HOUSING_OPTIONS, a.housing) + (a.housing === 'rent' && a.monthlyRent ? ` ${formatCurrency(a.monthlyRent)}/mo` : ''),
              ].filter(Boolean).join(' · ')}
              onEdit={() => setEditing({ address: a, kind: a.kind })}
              onDelete={() => remove.mutate(a.id, { onError: (e) => toast.error(e.message) })}
            />
          ))}
        </ul>
      )}
      {needsFormer && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
          <TriangleAlertIcon className="size-3.5" />
          Less than 2 years at the current address: add the former address too.
        </p>
      )}
      {editing && (
        <AddressDialog
          loanId={loanId}
          organizationId={organizationId}
          contactId={borrower.contactId}
          address={editing.address}
          defaultKind={editing.kind}
          usedKinds={usedKinds}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionCard>
  )
}
