import type * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CurrencyInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useSaveProperty, type PropertyInput } from '@/lib/api/properties'
import type { Property, PropertyStatus } from '@/lib/api/types'
import { PROPERTY_STATUS_OPTIONS, PROPERTY_TYPE_OPTIONS } from './options'

const blank = (status: PropertyStatus): PropertyInput => ({
  addressLine: '',
  city: '',
  state: 'TX',
  zip: '',
  county: '',
  propertyType: 'single_family',
  status,
  listPrice: null,
  estimatedValue: null,
  annualTaxes: null,
  annualInsurance: null,
  monthlyHoa: null,
  monthlyRent: null,
  isHomestead: status === 'current_home',
  listingUrl: '',
})

function fromProperty(p: Property): PropertyInput {
  return {
    addressLine: p.addressLine,
    city: p.city,
    state: p.state,
    zip: p.zip,
    county: p.county,
    propertyType: p.propertyType,
    status: p.status,
    listPrice: p.listPrice,
    estimatedValue: p.estimatedValue,
    annualTaxes: p.annualTaxes,
    annualInsurance: p.annualInsurance,
    monthlyHoa: p.monthlyHoa,
    monthlyRent: p.monthlyRent,
    isHomestead: p.isHomestead,
    listingUrl: p.listingUrl,
  }
}

/** Add or edit a property. Calls onSaved with the property id. */
export function PropertyDialog({
  loanId,
  organizationId,
  property,
  defaultStatus,
  showRent,
  open,
  onOpenChange,
  onSaved,
}: {
  loanId: string
  organizationId: string
  property: Property | null
  defaultStatus: PropertyStatus
  showRent: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (id: string, input: PropertyInput) => void
}) {
  const save = useSaveProperty(loanId, organizationId)
  const [form, setForm] = useState<PropertyInput>(() => (property ? fromProperty(property) : blank(defaultStatus)))
  const [submitted, setSubmitted] = useState(false)
  const set = <K extends keyof PropertyInput>(key: K) => (value: PropertyInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  const errors = {
    addressLine: !form.addressLine.trim() ? 'Address is required' : undefined,
    state: !/^[A-Za-z]{2}$/.test(form.state.trim()) ? 'Use the 2-letter state code' : undefined,
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    save.mutate(
      { ...form, id: property?.id },
      {
        onSuccess: (id) => {
          toast.success(property ? 'Property saved' : 'Property added')
          onSaved?.(id, form)
          onOpenChange(false)
        },
        onError: (error) => toast.error(`Could not save property: ${error.message}`),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{property ? 'Edit property' : 'Add property'}</DialogTitle>
          <DialogDescription>Value, taxes and insurance entered here feed the Overview numbers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormGrid>
            <Input label="Street address" value={form.addressLine} onChange={set('addressLine')} required span={6} autoFocus error={submitted ? errors.addressLine : undefined} />
            <Input label="City" value={form.city ?? ''} onChange={set('city')} span={2} />
            <Input label="State" value={form.state} onChange={(v) => set('state')(v.toUpperCase().slice(0, 2))} required error={submitted ? errors.state : undefined} />
            <Input label="ZIP" value={form.zip ?? ''} onChange={set('zip')} inputMode="numeric" />
            <Input label="County" value={form.county ?? ''} onChange={set('county')} span={2} />
            <Select label="Status" value={form.status} onChange={set('status')} options={PROPERTY_STATUS_OPTIONS} required span={2} />
            <Select label="Property type" value={form.propertyType} onChange={set('propertyType')} options={PROPERTY_TYPE_OPTIONS} span={2} />
            <Input label="Listing link" type="url" value={form.listingUrl ?? ''} onChange={set('listingUrl')} placeholder="https://" span={2} />
            <CurrencyInput label="List price" value={form.listPrice} onChange={set('listPrice')} span={2} />
            <CurrencyInput label="Estimated / appraised value" value={form.estimatedValue} onChange={set('estimatedValue')} span={2} />
            <CurrencyInput label="Annual taxes" value={form.annualTaxes} onChange={set('annualTaxes')} span={2} />
            <CurrencyInput label="Annual insurance" value={form.annualInsurance} onChange={set('annualInsurance')} span={2} />
            <CurrencyInput label="Monthly HOA" value={form.monthlyHoa} onChange={set('monthlyHoa')} span={2} />
            {(showRent || form.monthlyRent !== null) && (
              <CurrencyInput label="Monthly rent" value={form.monthlyRent} onChange={set('monthlyRent')} span={2} />
            )}
          </FormGrid>
          <ToggleChipGroup>
            <ToggleChip label="Texas homestead" pressed={form.isHomestead} onChange={set('isHomestead')} />
          </ToggleChipGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : property ? 'Save' : 'Add property'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
