import { useQuery } from '@tanstack/react-query'
import { phoneDigits } from '@/lib/pipeline/helpers'
import type { LoanPurpose, PipelineStage } from '@/lib/pipeline/stages'
import { db, keys, unwrap } from './client'
import type { ContactSummary } from './types'

interface ContactSummaryRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  created_at: string
  loans: { loan: { id: string; stage: PipelineStage; purpose: LoanPurpose; stage_changed_at: string } | null }[]
}

const CONTACT_SUMMARY_SELECT = `
  id, first_name, last_name, email, phone, created_at,
  loans:loan_borrowers ( loan:loans!loan_borrowers_loan_id_fkey ( id, stage, purpose, stage_changed_at ) )
`

function toSummary(row: ContactSummaryRow): ContactSummary {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    loans: row.loans
      .map((l) => l.loan)
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => ({ id: l.id, stage: l.stage, purpose: l.purpose, stageChangedAt: l.stage_changed_at }))
      .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt)),
  }
}

/** Every person the signed-in user can see, with their loans. */
export function useContacts() {
  return useQuery({
    queryKey: keys.contacts,
    queryFn: async () => {
      const rows = unwrap<ContactSummaryRow[]>(
        await db().from('contacts').select(CONTACT_SUMMARY_SELECT).order('created_at', { ascending: false }),
      )
      return rows.map(toSummary)
    },
  })
}

/** Escape % and _ so an email is matched literally by ILIKE. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * People already in LOSuite with the same email or phone, so New Lead can
 * offer to add a loan to them instead of creating a duplicate (rule 3).
 */
export function useMatchingContacts(email: string, phone: string) {
  const cleanEmail = email.trim().toLowerCase()
  const digits = phoneDigits(phone) ?? ''
  const emailReady = /.+@.+\..+/.test(cleanEmail)
  const phoneReady = digits.length >= 7

  return useQuery({
    queryKey: keys.matches(emailReady ? cleanEmail : '', phoneReady ? digits : ''),
    enabled: emailReady || phoneReady,
    staleTime: 10_000,
    queryFn: async () => {
      const lookups = []
      if (emailReady) {
        lookups.push(db().from('contacts').select(CONTACT_SUMMARY_SELECT).ilike('email', likeLiteral(cleanEmail)).limit(5))
      }
      if (phoneReady) {
        lookups.push(db().from('contacts').select(CONTACT_SUMMARY_SELECT).eq('phone_digits', digits).limit(5))
      }
      const results = await Promise.all(lookups)
      const byId = new Map<string, ContactSummary>()
      for (const result of results) {
        for (const row of unwrap<ContactSummaryRow[]>(result)) byId.set(row.id, toSummary(row))
      }
      return [...byId.values()]
    },
  })
}
