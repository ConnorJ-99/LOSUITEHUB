// Borrower applications from MPS-HQ's side (Stage 5, docs/plans/borrower-application.md):
// the file's applications (portal or /apply), "Add to the 1003" (the database's
// apply_application(): fills blanks and adds missing rows, never overwrites),
// the MISMO file saved to Documents, and drafting the application link.
// Before the applications script has run, reads come back empty (null).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { applicationInvite } from '@/lib/portal/messages'
import type { ApplicationAnswers } from '../../../supabase/functions/apply/form'
import { db, keys, unwrap } from './client'
import { LOAN_FILES_BUCKET, storagePathFor } from './documents'

export interface BorrowerApplication {
  id: string
  contactId: string | null
  status: 'in_progress' | 'submitted'
  step: string | null
  outcome: 'new_lead' | 'new_loan_existing_person' | 'existing_open_loan' | 'portal' | null
  submittedAt: string | null
  appliedAt: string | null
  mismoDocumentId: string | null
  conditionsAddedAt: string | null
  creditAuthAt: string | null
  creditAuthVersion: string | null
  answers: ApplicationAnswers
  updatedAt: string
}

const appsKey = (loanId: string) => ['borrowerApplications', loanId] as const

interface Row {
  id: string
  contact_id: string | null
  status: 'in_progress' | 'submitted'
  step: string | null
  outcome: BorrowerApplication['outcome']
  submitted_at: string | null
  applied_at: string | null
  mismo_document_id: string | null
  conditions_added_at: string | null
  credit_auth_at: string | null
  credit_auth_version: string | null
  answers: ApplicationAnswers
  updated_at: string
}

export function useBorrowerApplications(loanId: string) {
  return useQuery({
    queryKey: appsKey(loanId),
    queryFn: async (): Promise<BorrowerApplication[] | null> => {
      const r = await db()
        .from('borrower_applications')
        .select('id, contact_id, status, step, outcome, submitted_at, applied_at, mismo_document_id, conditions_added_at, credit_auth_at, credit_auth_version, answers, updated_at')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false })
      if (r.error) {
        if (/borrower_applications/.test(r.error.message) || r.error.code === '42P01' || r.error.code === 'PGRST205') return null
        throw new Error(r.error.message)
      }
      return (r.data as Row[]).map((x) => ({
        id: x.id,
        contactId: x.contact_id,
        status: x.status,
        step: x.step,
        outcome: x.outcome,
        submittedAt: x.submitted_at,
        appliedAt: x.applied_at,
        mismoDocumentId: x.mismo_document_id,
        conditionsAddedAt: x.conditions_added_at,
        creditAuthAt: x.credit_auth_at,
        creditAuthVersion: x.credit_auth_version,
        answers: x.answers,
        updatedAt: x.updated_at,
      }))
    },
  })
}

export interface AppliedCounts {
  jobs_and_income: number
  assets: number
  debts: number
  homes?: number
  co_borrower: boolean
}

/** Records that the file's suggested conditions were added after this application (done once). */
export function useMarkConditionsAdded(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (applicationId: string) => {
      unwrap(await db().from('borrower_applications').update({ conditions_added_at: new Date().toISOString() }).eq('id', applicationId).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: appsKey(loanId) }),
  })
}

/** "Add to the 1003": fills the file's blanks and adds missing rows from the answers. */
export function useApplyApplication(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrap<AppliedCounts>(await db().rpc('apply_application', { p_id: id })),
    onSettled: () => {
      for (const k of [appsKey(loanId), keys.application(loanId), keys.loan(loanId), keys.loanFile(loanId)]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** Saves the MISMO 3.4 file built from the 1003 to Documents and records it on the application. */
export function useSaveApplicationMismo(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { applicationId: string; organizationId: string; fileName: string; xml: string }) => {
      const path = storagePathFor(v.organizationId, loanId, v.fileName)
      const file = new Blob([v.xml], { type: 'application/xml' })
      const up = await db().storage.from(LOAN_FILES_BUCKET).upload(path, file, { contentType: 'application/xml', upsert: false })
      if (up.error) throw new Error(/mime/i.test(up.error.message) ? 'Run the borrower applications script in Supabase first (it lets Documents keep MISMO files).' : `Saving the MISMO file failed: ${up.error.message}`)
      const row = await db()
        .from('loan_documents')
        .insert({ organization_id: v.organizationId, loan_id: loanId, kind: 'mismo_file', file_name: v.fileName, storage_path: path, content_type: 'application/xml', size_bytes: file.size, template_version: 'application mismo-3.4' })
        .select('id')
      if (row.error) {
        await db().storage.from(LOAN_FILES_BUCKET).remove([path])
        throw new Error(row.error.message)
      }
      const docId = (row.data as { id: string }[])[0].id
      unwrap(await db().from('borrower_applications').update({ mismo_document_id: docId }).eq('id', v.applicationId).select('id'))
      return docId
    },
    onSettled: () => {
      for (const k of [appsKey(loanId), keys.documents(loanId)]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** The application link (the portal link opened on the application) as a draft in the Action Queue. */
export function useDraftApplicationInvite(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; contactId: string; name: string; firstName: string; loName: string; phone: string | null; email: string | null; url: string; channel: 'text' | 'email' }) => {
      const m = applicationInvite({ firstName: v.firstName, loName: v.loName, url: v.url })
      const to = v.channel === 'text' ? v.phone : v.email
      if (!to) throw new Error(`${v.name} has no ${v.channel === 'text' ? 'phone' : 'email'} on file.`)
      unwrap(
        await db()
          .from('action_items')
          .insert({
            organization_id: v.organizationId,
            loan_id: loanId,
            kind: 'draft_message',
            title: `Application link: ${v.name}`,
            payload: { channel: v.channel, to, subject: v.channel === 'email' ? m.subject : null, body: v.channel === 'text' ? m.text : m.email, contactId: v.contactId },
            sources: [],
            confidence: null,
            due_on: null,
            ai_run_id: null,
          })
          .select('id'),
      )
    },
    onSettled: () => {
      for (const k of [keys.queue(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** The link anyone can use to apply; new leads go to `loEmail` (else the company owner). */
export const standaloneApplyUrl = (origin: string, loEmail: string | null) => `${origin.replace(/\/$/, '')}/apply${loEmail ? `?lo=${encodeURIComponent(loEmail)}` : ''}`
