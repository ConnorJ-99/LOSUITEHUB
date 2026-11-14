// The file's loan type on the pipeline card, from the profile (Pipeline
// redesign): Automatic works it out from the program, mortgage type and income
// documentation; picking one sets loans.lead_type.
import { toast } from 'sonner'
import { Select } from '@/components/shared'
import { useLoanLeadType, useSetLeadType } from '@/lib/api/board'
import type { LoanProfile } from '@/lib/api/types'
import { LEAD_TYPES, leadTypeFor, leadTypeInfo, type LeadTypeId } from '@/lib/pipeline/leadType'

const AUTO = 'auto'

export function LeadTypePicker({ loan, span = 2 }: { loan: LoanProfile; span?: 1 | 2 | 3 }) {
  const current = useLoanLeadType(loan.id)
  const set = useSetLeadType()
  if (current.data === undefined) return null // Before the pipeline redesign script has run.
  const auto = leadTypeInfo(leadTypeFor({ leadType: null, purpose: loan.purpose, programFamily: null, mortgageType: loan.details.mortgageType, incomeDocType: loan.details.incomeDocType })).label
  return (
    <Select
      label="Pipeline card type"
      value={current.data ?? AUTO}
      options={[{ value: AUTO, label: `Automatic (${auto})` }, ...LEAD_TYPES.map((t) => ({ value: t.id, label: t.label }))]}
      onChange={(v) => set.mutate({ id: loan.id, leadType: v === AUTO ? null : (v as LeadTypeId) }, { onSuccess: () => toast.success('Card type saved'), onError: (e) => toast.error(e.message) })}
      span={span}
    />
  )
}
