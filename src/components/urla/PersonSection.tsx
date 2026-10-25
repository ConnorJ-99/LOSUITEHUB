import { toast } from 'sonner'
import { DateInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useUpdatePerson, type ApplicationBorrower, type PersonDetails } from '@/lib/api/urla'
import { CITIZENSHIP_OPTIONS, MARITAL_STATUS_OPTIONS } from '@/lib/urla/options'
import { SectionCard, SubHeading, YesNo } from './parts'
import { useDraft } from './useDraft'

/** 1003 section 1a (personal and contact information) and section 7 (military service). */
export function PersonSection({ loanId, borrower }: { loanId: string; borrower: ApplicationBorrower }) {
  const update = useUpdatePerson(loanId)
  const { form, set, changes, dirty, reset } = useDraft<PersonDetails>(borrower.person)

  const save = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First and last name are required')
      return
    }
    update.mutate(
      { contactId: borrower.contactId, changes },
      { onSuccess: () => toast.success('Borrower information saved'), onError: (e) => toast.error(`Could not save: ${e.message}`) },
    )
  }

  const text = (key: keyof PersonDetails) => (v: string) => set(key)((v || null) as never)

  return (
    <SectionCard
      id="section-1"
      title="1a. Personal information"
      description="Saved on the person, so it carries over to their future loans. No SSN is stored in LOSuite."
      dirty={dirty}
      saving={update.isPending}
      onSave={save}
      onDiscard={reset}
    >
      <FormGrid>
        <Input label="First name" value={form.firstName} onChange={(v) => set('firstName')(v)} required span={2} />
        <Input label="Middle name" value={form.middleName ?? ''} onChange={text('middleName')} />
        <Input label="Last name" value={form.lastName} onChange={(v) => set('lastName')(v)} required span={2} />
        <Input label="Suffix" value={form.suffix ?? ''} onChange={text('suffix')} placeholder="Jr., Sr., III" />
        <DateInput label="Date of birth" value={form.dateOfBirth} onChange={set('dateOfBirth')} span={2} />
        <Select label="Citizenship" value={form.citizenship} onChange={set('citizenship')} options={CITIZENSHIP_OPTIONS} span={2} />
        <Select label="Marital status" value={form.maritalStatus} onChange={set('maritalStatus')} options={MARITAL_STATUS_OPTIONS} span={2} />
        <Input
          label="Dependents"
          inputMode="numeric"
          value={form.dependentsCount?.toString() ?? ''}
          onChange={(v) => set('dependentsCount')(v.trim() === '' ? null : Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0)))}
        />
        <Input label="Dependents' ages" value={form.dependentsAges ?? ''} onChange={text('dependentsAges')} placeholder="e.g. 4, 7" span={2} />
      </FormGrid>

      <SubHeading>Contact information</SubHeading>
      <FormGrid>
        <Input label="Cell phone" type="tel" value={form.phone ?? ''} onChange={text('phone')} span={2} />
        <Input label="Home phone" type="tel" value={form.homePhone ?? ''} onChange={text('homePhone')} span={2} />
        <Input label="Work phone" type="tel" value={form.workPhone ?? ''} onChange={text('workPhone')} />
        <Input label="Ext." value={form.workPhoneExt ?? ''} onChange={text('workPhoneExt')} />
        <Input label="Email" type="email" value={form.email ?? ''} onChange={text('email')} span={6} />
      </FormGrid>

      <SubHeading>7. Military service</SubHeading>
      <YesNo
        label="Did you (or your deceased spouse) ever serve, or are you currently serving, in the United States Armed Forces?"
        value={form.militaryService}
        onChange={set('militaryService')}
      >
        <div className="space-y-3">
          <ToggleChipGroup>
            <ToggleChip label="Currently serving on active duty" pressed={form.militaryActiveDuty} onChange={set('militaryActiveDuty')} />
            <ToggleChip label="Retired, discharged or separated" pressed={form.militaryRetired} onChange={set('militaryRetired')} />
            <ToggleChip label="Non-activated Reserve or National Guard only" pressed={form.militaryReserveOnly} onChange={set('militaryReserveOnly')} />
            <ToggleChip label="Surviving spouse" pressed={form.militarySurvivingSpouse} onChange={set('militarySurvivingSpouse')} />
          </ToggleChipGroup>
          {form.militaryActiveDuty && (
            <FormGrid>
              <DateInput label="Projected end of service / tour" value={form.militaryServiceExpiresOn} onChange={set('militaryServiceExpiresOn')} span={2} />
            </FormGrid>
          )}
        </div>
      </YesNo>
    </SectionCard>
  )
}
