// Who a generated PDF is from: the company (Settings → Company) and the loan
// officer (the loan's assigned LO, from their Settings profile). Pure.

import type { Organization, Profile } from '@/lib/api/settings'

export interface DocBrand {
  company: { legalName: string; nmls: string | null; address: string | null }
  lo: { name: string; nmls: string | null; phone: string | null; email: string | null }
}

/** "123 Main St, Frisco, TX 75034". */
export function oneLineAddress(o: Pick<Organization, 'addressLine' | 'city' | 'state' | 'zip'>): string | null {
  const place = [o.city, [o.state, o.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [o.addressLine, place].filter(Boolean).join(', ') || null
}

export function docBrand(org: Organization | null, lo: Profile | null): DocBrand {
  return {
    company: { legalName: org?.name ?? 'MPS Mortgage LLC', nmls: org?.nmls ?? null, address: org ? oneLineAddress(org) : null },
    lo: { name: lo?.fullName || lo?.email || 'Loan Officer', nmls: lo?.nmls ?? null, phone: lo?.phone ?? null, email: lo?.email ?? null },
  }
}

/** What's missing before a PDF can go to a borrower (NMLS numbers are required on every document). */
export function brandProblems(b: DocBrand): string[] {
  return [...(b.company.nmls ? [] : ['the company NMLS # (Settings → Company)']), ...(b.lo.nmls ? [] : ["the loan officer's NMLS # (Settings → My profile)"])]
}
