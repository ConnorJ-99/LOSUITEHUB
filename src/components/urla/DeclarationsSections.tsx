import { toast } from 'sonner'
import { CurrencyInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useSaveDeclarations, type ApplicationBorrower, type Declarations } from '@/lib/api/urla'
import { fullName } from '@/lib/pipeline/helpers'
import {
  APPLICATION_METHOD_OPTIONS,
  DECLARATION_QUESTIONS_5A,
  DECLARATION_QUESTIONS_5B,
  ETHNICITY_OPTIONS,
  PRIOR_TITLE_OPTIONS,
  PRIOR_USAGE_OPTIONS,
  RACE_OPTIONS,
  SEX_OPTIONS,
  type HmdaEthnicity,
  type HmdaRace,
  type HmdaSex,
} from '@/lib/urla/options'
import { SectionCard, SubHeading, YesNo } from './parts'
import { useDraft } from './useDraft'

type BoolKey = {
  [K in keyof Declarations]: Declarations[K] extends boolean | null ? K : never
}[keyof Declarations]

/** Section 5: declarations for one borrower. */
export function DeclarationsSection({ loanId, borrower, isPurchase }: { loanId: string; borrower: ApplicationBorrower; isPurchase: boolean }) {
  const save = useSaveDeclarations(loanId)
  const { form, set, changes, dirty, reset } = useDraft<Declarations>(borrower.declarations)

  const onSave = () =>
    save.mutate(
      { contactId: borrower.contactId, values: changes },
      { onSuccess: () => toast.success('Declarations saved'), onError: (e) => toast.error(`Could not save: ${e.message}`) },
    )

  const question = (q: { key: string; letter: string; text: string }) => {
    const key = q.key as BoolKey
    const followUp =
      key === 'ownedPropertyPast3Years' ? (
        <FormGrid>
          <Select label="Type of property owned" value={form.priorPropertyUsage} onChange={set('priorPropertyUsage')} options={PRIOR_USAGE_OPTIONS} span={3} />
          <Select label="How title was held" value={form.priorTitleHeld} onChange={set('priorTitleHeld')} options={PRIOR_TITLE_OPTIONS} span={3} />
        </FormGrid>
      ) : key === 'borrowingUndisclosedMoney' ? (
        <FormGrid>
          <CurrencyInput label="Amount" value={form.undisclosedMoneyAmount} onChange={set('undisclosedMoneyAmount')} span={2} />
        </FormGrid>
      ) : key === 'bankruptcyPast7Years' ? (
        <ToggleChipGroup>
          <ToggleChip label="Chapter 7" pressed={form.bankruptcyChapter7} onChange={set('bankruptcyChapter7')} />
          <ToggleChip label="Chapter 11" pressed={form.bankruptcyChapter11} onChange={set('bankruptcyChapter11')} />
          <ToggleChip label="Chapter 12" pressed={form.bankruptcyChapter12} onChange={set('bankruptcyChapter12')} />
          <ToggleChip label="Chapter 13" pressed={form.bankruptcyChapter13} onChange={set('bankruptcyChapter13')} />
        </ToggleChipGroup>
      ) : undefined
    return (
      <YesNo key={q.key} prefix={q.letter} label={q.text} value={form[key] as boolean | null} onChange={(v) => set(key)(v as never)}>
        {followUp}
      </YesNo>
    )
  }

  return (
    <SectionCard
      id="section-5"
      title={`5. Declarations: ${fullName(borrower.person)}`}
      dirty={dirty}
      saving={save.isPending}
      onSave={onSave}
      onDiscard={reset}
    >
      <SubHeading>5a. About this property and your money for this loan</SubHeading>
      <div className="divide-y">
        {DECLARATION_QUESTIONS_5A.filter((q) => isPurchase || !('purchaseOnly' in q)).map(question)}
      </div>
      <SubHeading>5b. About your finances</SubHeading>
      <div className="divide-y">{DECLARATION_QUESTIONS_5B.map(question)}</div>
    </SectionCard>
  )
}

/** Toggle one value in a multi-select list; choosing "not provided" clears the rest and vice versa. */
function toggle<T extends string>(list: T[], value: T, on: boolean, children: readonly { value: string }[] = []): T[] {
  if (!on) return list.filter((v) => v !== value && !children.some((c) => c.value === v))
  if (value === 'not_provided') return [value]
  return [...list.filter((v) => v !== 'not_provided'), value]
}

/** Section 8: demographic information (HMDA), for one borrower. */
export function DemographicsSection({ loanId, borrower }: { loanId: string; borrower: ApplicationBorrower }) {
  const save = useSaveDeclarations(loanId)
  const { form, set, changes, dirty, reset } = useDraft<Declarations>(borrower.declarations)

  const onSave = () =>
    save.mutate(
      { contactId: borrower.contactId, values: changes },
      { onSuccess: () => toast.success('Demographic information saved'), onError: (e) => toast.error(`Could not save: ${e.message}`) },
    )

  const group = <T extends string>(
    options: readonly { value: string; label: string; children: readonly { value: string; label: string }[] }[],
    selected: T[],
    onChange: (next: T[]) => void,
  ) => (
    <div className="space-y-2">
      {options.map((o) => {
        const on = selected.includes(o.value as T)
        return (
          <div key={o.value} className="space-y-2">
            <ToggleChip label={o.label} pressed={on} onChange={(p) => onChange(toggle(selected, o.value as T, p, o.children))} />
            {on && o.children.length > 0 && (
              <ToggleChipGroup className="pl-6">
                {o.children.map((c) => (
                  <ToggleChip key={c.value} label={c.label} pressed={selected.includes(c.value as T)} onChange={(p) => onChange(toggle(selected, c.value as T, p))} />
                ))}
              </ToggleChipGroup>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <SectionCard
      id="section-8"
      title={`8. Demographic information: ${fullName(borrower.person)}`}
      description="Collected for federal fair-lending monitoring. The borrower may choose not to provide it."
      dirty={dirty}
      saving={save.isPending}
      onSave={onSave}
      onDiscard={reset}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <SubHeading>Ethnicity</SubHeading>
          {group<HmdaEthnicity>(ETHNICITY_OPTIONS, form.ethnicities, set('ethnicities'))}
          {form.ethnicities.includes('other_hispanic') && (
            <Input label="Other Hispanic or Latino origin" value={form.ethnicityOtherText ?? ''} onChange={(v) => set('ethnicityOtherText')(v || null)} className="mt-2" />
          )}
        </div>
        <div>
          <SubHeading>Race</SubHeading>
          {group<HmdaRace>(RACE_OPTIONS, form.races, set('races'))}
          {form.races.includes('american_indian_or_alaska_native') && (
            <Input label="Enrolled or principal tribe" value={form.raceTribeText ?? ''} onChange={(v) => set('raceTribeText')(v || null)} className="mt-2" />
          )}
          {form.races.includes('other_asian') && (
            <Input label="Other Asian race" value={form.raceOtherAsianText ?? ''} onChange={(v) => set('raceOtherAsianText')(v || null)} className="mt-2" />
          )}
          {form.races.includes('other_pacific_islander') && (
            <Input label="Other Pacific Islander race" value={form.raceOtherPacificIslanderText ?? ''} onChange={(v) => set('raceOtherPacificIslanderText')(v || null)} className="mt-2" />
          )}
        </div>
        <div>
          <SubHeading>Sex</SubHeading>
          <div className="space-y-2">
            {SEX_OPTIONS.map((o) => (
              <div key={o.value}>
                <ToggleChip
                  label={o.label}
                  pressed={form.sexes.includes(o.value)}
                  onChange={(p) => set('sexes')(toggle<HmdaSex>(form.sexes, o.value, p))}
                />
              </div>
            ))}
          </div>
          <SubHeading>How the application was taken</SubHeading>
          <Select label="Application method" value={form.applicationMethod} onChange={set('applicationMethod')} options={APPLICATION_METHOD_OPTIONS} />
        </div>
      </div>
    </SectionCard>
  )
}
