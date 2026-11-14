import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'
import { useAuth } from '@/lib/auth/context'
import type { PartnerFile, PartnerKind } from '@/lib/partners/match'
import type { InsuranceLine, PartnerDetails } from '@/lib/partners/details'
import type { PartnerStage } from '@/lib/partners/stages'
import type { PipelineStage } from '@/lib/pipeline/stages'

export interface Partner {
  id: string
  kind: PartnerKind
  name: string
  company: string | null
  email: string | null
  phone: string | null
  smsConsent: boolean | null
  emailConsent: boolean | null
  smsOptedOutAt: string | null
  emailOptedOutAt: string | null
  /** Set only by GHL matching (Add to GoHighLevel). */
  ghlContactId: string | null
  /** Realtors: their opportunity in GHL's realtor pipeline (set only by the ghl function). */
  ghlOpportunityId: string | null
  notes: string | null
  /** Relationship stage, owner and dates (Phase 4). Undefined until the partner stages script has run. */
  stage?: PartnerStage
  assignedLoId: string | null
  nextFollowUpOn: string | null
  lastMetOn: string | null
  source: string | null
  addedFrom: 'file_team' | 'website' | 'manual'
  createdAt: string
  /** Files you can see that they're on. */
  files: (PartnerFile & { stage: PipelineStage })[]
  /** When their latest website partner form came in. */
  lastInquiryAt: string | null
  /** Insurance / title fields and the Gmail switch. Undefined until the partner requests script has run. */
  details?: PartnerDetails
}

interface PartnerRow {
  id: string
  kind: PartnerKind
  name: string
  company: string | null
  email: string | null
  phone: string | null
  sms_consent: boolean | null
  email_consent: boolean | null
  sms_opted_out_at: string | null
  email_opted_out_at: string | null
  ghl_contact_id: string | null
  ghl_opportunity_id?: string | null
  notes: string | null
  stage?: PartnerStage
  assigned_lo_id?: string | null
  next_follow_up_on?: string | null
  last_met_on?: string | null
  source?: string | null
  added_from: Partner['addedFrom']
  created_at: string
  team: {
    role: string
    loan: {
      id: string
      stage: PipelineStage
      closing_date: string | null
      borrowers: { role: string; contact: { first_name: string; last_name: string } | null }[]
    } | null
  }[]
  inquiries: { received_at: string }[]
  email_via_gmail?: boolean | null
  role?: string | null
  extra_emails?: string[]
  office_address?: string | null
  preferred?: boolean
  email_domain?: string | null
  agency?: string | null
  carriers?: string[]
  license_number?: string | null
  insurance_lines?: InsuranceLine[]
  escrow_officer_name?: string | null
  escrow_officer_email?: string | null
  processor_name?: string | null
  processor_email?: string | null
  title_underwriter?: string | null
  wire_verify_phone?: string | null
  last_wire_instructions_doc_id?: string | null
}

function toDetails(r: PartnerRow): PartnerDetails | undefined {
  if (r.email_via_gmail === undefined) return undefined
  return {
    role: r.role ?? null,
    extraEmails: r.extra_emails ?? [],
    officeAddress: r.office_address ?? null,
    preferred: !!r.preferred,
    emailViaGmail: !!r.email_via_gmail,
    emailDomain: r.email_domain ?? null,
    agency: r.agency ?? null,
    carriers: r.carriers ?? [],
    licenseNumber: r.license_number ?? null,
    insuranceLines: r.insurance_lines ?? [],
    escrowOfficerName: r.escrow_officer_name ?? null,
    escrowOfficerEmail: r.escrow_officer_email ?? null,
    processorName: r.processor_name ?? null,
    processorEmail: r.processor_email ?? null,
    titleUnderwriter: r.title_underwriter ?? null,
    wireVerifyPhone: r.wire_verify_phone ?? null,
    lastWireInstructionsDocId: r.last_wire_instructions_doc_id ?? null,
  }
}

// * so the page keeps working before a script adds columns (the Phase 4 stage fields).
const SELECT = `*,
  team:loan_team_members!loan_team_members_partner_id_fkey ( role, loan:loans!loan_team_members_loan_id_fkey ( id, stage, closing_date, borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) ) ) ),
  inquiries:lead_submissions!lead_submissions_partner_id_fkey ( received_at )`

function toPartner(r: PartnerRow): Partner {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    smsConsent: r.sms_consent,
    emailConsent: r.email_consent,
    smsOptedOutAt: r.sms_opted_out_at,
    emailOptedOutAt: r.email_opted_out_at,
    ghlContactId: r.ghl_contact_id,
    ghlOpportunityId: r.ghl_opportunity_id ?? null,
    notes: r.notes,
    stage: r.stage,
    assignedLoId: r.assigned_lo_id ?? null,
    nextFollowUpOn: r.next_follow_up_on ?? null,
    lastMetOn: r.last_met_on ?? null,
    source: r.source ?? null,
    addedFrom: r.added_from,
    createdAt: r.created_at,
    // A file you can't see comes back without its loan.
    files: r.team.flatMap((t) => {
      if (!t.loan) return []
      const primary = t.loan.borrowers.find((b) => b.role === 'primary')?.contact ?? t.loan.borrowers[0]?.contact
      return [{ loanId: t.loan.id, role: t.role, stage: t.loan.stage, closingDate: t.loan.closing_date, borrowerName: primary ? `${primary.first_name} ${primary.last_name}`.trim() : 'Unnamed borrower' }]
    }),
    lastInquiryAt: r.inquiries.map((i) => i.received_at).sort().at(-1) ?? null,
    details: toDetails(r),
  }
}

/** Everyone in the company's partners, with the files each is on. */
export function usePartners() {
  return useQuery({
    queryKey: keys.partners,
    queryFn: async (): Promise<Partner[]> => unwrap<PartnerRow[]>(await db().from('partners').select(SELECT).order('name')).map(toPartner),
  })
}

export interface PartnerDraft {
  id?: string
  kind: PartnerKind
  name: string
  company: string
  email: string
  phone: string
  /** Left out (undefined) when the partner opted out: only a person restoring consent can change it. */
  smsConsent?: boolean | null
  emailConsent?: boolean | null
  notes: string
  /** Phase 4 fields: sent only when the partner stages script has run (the dialog shows them then). */
  stages?: { stage: PartnerStage; assignedLoId: string | null; nextFollowUpOn: string | null; lastMetOn: string | null; source: string }
  /** Sent only when the partner requests script has run. */
  details?: Omit<PartnerDetails, 'emailDomain' | 'lastWireInstructionsDocId'>
}

const blank = (v: string | null) => v?.trim() || null

/** Turns database refusals into something a person can act on. */
function partnerError(error: { code?: string; message: string }): Error {
  if (error.code === '23505' && /email/.test(error.message)) return new Error('Another partner already has this email.')
  if (error.code === '23503') return new Error('They\'re still on a file (maybe one you can\'t see), so they can\'t be deleted. Take them off the file first.')
  if (error.code === '42501' || /row-level security/.test(error.message)) return new Error('Only owners, admins and loan officers can change partners.')
  return new Error(error.message)
}

/** Every screen that shows a file's team or partners. */
function useInvalidatePartners() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.partners })
    queryClient.invalidateQueries({ queryKey: ['loanFile'] })
  }
}

export function useSavePartner() {
  const invalidate = useInvalidatePartners()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (p: PartnerDraft): Promise<string> => {
      if (!p.name.trim()) throw new Error('The partner needs a name.')
      const row = {
        kind: p.kind,
        name: p.name.trim(),
        company: p.company.trim() || null,
        email: p.email.trim().toLowerCase() || null,
        phone: p.phone.trim() || null,
        ...(p.smsConsent !== undefined && { sms_consent: p.smsConsent }),
        ...(p.emailConsent !== undefined && { email_consent: p.emailConsent }),
        notes: p.notes.trim() || null,
        ...(p.details && {
          role: blank(p.details.role),
          extra_emails: p.details.extraEmails,
          office_address: blank(p.details.officeAddress),
          preferred: p.details.preferred,
          email_via_gmail: p.details.emailViaGmail,
          agency: blank(p.details.agency),
          carriers: p.details.carriers.map((c) => c.trim()).filter(Boolean),
          license_number: blank(p.details.licenseNumber),
          insurance_lines: p.details.insuranceLines,
          escrow_officer_name: blank(p.details.escrowOfficerName),
          escrow_officer_email: blank(p.details.escrowOfficerEmail)?.toLowerCase() ?? null,
          processor_name: blank(p.details.processorName),
          processor_email: blank(p.details.processorEmail)?.toLowerCase() ?? null,
          title_underwriter: blank(p.details.titleUnderwriter),
          wire_verify_phone: blank(p.details.wireVerifyPhone),
        }),
        ...(p.stages && { stage: p.stages.stage, assigned_lo_id: p.stages.assignedLoId, next_follow_up_on: p.stages.nextFollowUpOn, last_met_on: p.stages.lastMetOn, source: p.stages.source.trim() || null }),
      }
      const result = p.id
        ? await db().from('partners').update(row).eq('id', p.id).select('id')
        : await db().from('partners').insert({ ...row, organization_id: orgId, added_from: 'manual' }).select('id')
      if (result.error) throw partnerError(result.error)
      const rows = result.data as { id: string }[]
      if (rows.length === 0) throw new Error('Only owners, admins and loan officers can change partners.')
      return rows[0].id
    },
    onSettled: invalidate,
  })
}

export function useDeletePartner() {
  const invalidate = useInvalidatePartners()
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await db().from('partners').delete().eq('id', id).select('id')
      if (result.error) throw partnerError(result.error)
      if ((result.data as unknown[]).length === 0) throw new Error('Only owners, admins and loan officers can delete partners.')
    },
    onSettled: invalidate,
  })
}
