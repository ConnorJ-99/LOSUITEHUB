import type * as React from 'react'
import { Link } from 'react-router'
import type { LoanProfile } from '@/lib/api/types'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { formatPhone } from '@/lib/pipeline/helpers'
import { SectionCard } from './parts'

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || <span className="text-amber-700">Missing</span>}</dd>
    </div>
  )
}

/** Section 9: the company and the assigned loan officer, from Settings. */
export function OriginatorSection({ loan }: { loan: LoanProfile }) {
  const org = useOrganization()
  const lo = useProfile(loan.assignedLo?.id)
  const o = org.data
  const p = lo.data
  const orgAddress = o ? [o.addressLine, [o.city, [o.state, o.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') : ''

  return (
    <SectionCard
      id="section-9"
      title="9. Loan originator information"
      description="Filled in from Settings."
      action={
        <Link to="/settings" className="text-sm text-primary hover:underline">
          Edit in Settings
        </Link>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Item label="Organization" value={o?.name} />
        <Item label="Organization NMLS" value={o?.nmls} />
        <Item label="Address" value={orgAddress} />
        <Item label="Organization phone" value={o?.phone && formatPhone(o.phone)} />
        <Item label="Loan originator" value={p?.fullName ?? loan.assignedLo?.name} />
        <Item label="Originator NMLS" value={p?.nmls} />
        <Item label="State license" value={p?.stateLicense} />
        <Item label="Email / phone" value={p && [p.email, p.phone && formatPhone(p.phone)].filter(Boolean).join(' · ')} />
      </dl>
    </SectionCard>
  )
}
