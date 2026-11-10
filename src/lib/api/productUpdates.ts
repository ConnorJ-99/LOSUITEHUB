import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MatrixReading } from '../../../supabase/functions/assistant/matrix'
import type { UpdateChange, UpdateProposal } from '../../../supabase/functions/assistant/productUpdate'
import { applyChanges } from '@/lib/products/productUpdate'
import { invokeAssistant } from './assistant'
import { programAsReading } from './matrixImports'
import { db, unwrap } from './client'

/** A pasted lender email (Phase 0b), waiting for review, confirmed or discarded. */
export interface ProductUpdate {
  id: string
  organizationId: string
  lenderId: string | null
  lenderName: string | null
  subject: string | null
  pastedText: string
  receivedOn: string
  status: 'pending_review' | 'confirmed' | 'discarded'
  programIds: string[]
  /** The assistant's checked reading, plus the changes Connor ticked when he confirmed. */
  proposal: (UpdateProposal & { accepted?: string[] }) | null
  documentId: string | null
  createdAt: string
  decidedAt: string | null
  /** The matrix drafts it made, with their status. */
  drafts: { id: string; status: 'pending_review' | 'approved' | 'discarded'; programName: string }[]
}

interface Row {
  id: string
  organization_id: string
  lender_id: string | null
  subject: string | null
  pasted_text: string
  received_on: string
  status: ProductUpdate['status']
  program_ids: string[]
  proposal: ProductUpdate['proposal']
  document_id: string | null
  created_at: string
  decided_at: string | null
  lender: { name: string } | null
  drafts: { id: string; status: ProductUpdate['drafts'][number]['status']; reading: MatrixReading }[]
}

const SELECT = 'id, organization_id, lender_id, subject, pasted_text, received_on, status, program_ids, proposal, document_id, created_at, decided_at, lender:lenders(name), drafts:matrix_imports!matrix_imports_product_update_id_fkey(id, status, reading)'
const toUpdate = (r: Row): ProductUpdate => ({
  id: r.id,
  organizationId: r.organization_id,
  lenderId: r.lender_id,
  lenderName: r.lender?.name ?? null,
  subject: r.subject,
  pastedText: r.pasted_text,
  receivedOn: r.received_on,
  status: r.status,
  programIds: r.program_ids ?? [],
  proposal: r.proposal,
  documentId: r.document_id,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  drafts: (r.drafts ?? []).map((d) => ({ id: d.id, status: d.status, programName: d.reading.programs[0]?.name ?? 'Program' })),
})

export const updateKey = (id: string) => ['productUpdate', id] as const
const listKey = (lenderId: string | null) => ['productUpdates', lenderId] as const

export function useProductUpdate(id: string) {
  return useQuery({ queryKey: updateKey(id), queryFn: async () => toUpdate(unwrap<Row>(await db().from('product_updates').select(SELECT).eq('id', id).single())) })
}

/** One lender's updates (or, with null, every update still waiting), newest first. */
export function useProductUpdates(lenderId: string | null) {
  return useQuery({
    queryKey: listKey(lenderId),
    queryFn: async () => {
      let q = db().from('product_updates').select(SELECT)
      q = lenderId ? q.eq('lender_id', lenderId) : q.eq('status', 'pending_review')
      return unwrap<Row[]>(await q.order('created_at', { ascending: false }).limit(100)).map(toUpdate)
    },
  })
}

const refresh = (queryClient: ReturnType<typeof useQueryClient>, id?: string) => {
  for (const key of [['productUpdates'], ...(id ? [updateKey(id)] : []), ['lenderImports'], ['lenderDocuments'], ['programGuidelines']]) queryClient.invalidateQueries({ queryKey: key })
}

/** Saves the pasted email right away, so nothing is lost before it's reviewed. */
export function useCreateProductUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (u: { organizationId: string; lenderId: string | null; subject: string | null; pastedText: string; receivedOn: string }) =>
      unwrap<{ id: string }>(await db().from('product_updates').insert({ organization_id: u.organizationId, lender_id: u.lenderId, subject: u.subject, pasted_text: u.pastedText, received_on: u.receivedOn }).select('id').single()).id,
    onSuccess: () => refresh(queryClient),
  })
}

/** The lender, programs, subject and date, while the update waits for review. Changing the lender clears the reading. */
export function useSaveUpdateChoice(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: { lender_id?: string | null; program_ids?: string[]; subject?: string | null; received_on?: string; proposal?: ProductUpdate['proposal'] }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('product_updates').update(patch).eq('id', id).eq('status', 'pending_review').select('id'))
      if (rows.length === 0) throw new Error('This update was already decided, or only owners and admins can change it.')
    },
    onSuccess: () => refresh(queryClient, id),
  })
}

/** The assistant reads the email against the lender's programs. Nothing in the catalog changes. */
export function useReadProductUpdate(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => (await invokeAssistant<{ proposal: UpdateProposal }>({ task: 'product_update_read', updateId: id }, 'The assistant could not read this email.')).proposal,
    onSuccess: () => refresh(queryClient, id),
  })
}

/**
 * Confirm: the ticked changes are applied to a copy of each program's matrix
 * in use, and each program marked for a draft gets one (approved on the usual
 * review screen). The email is saved as a Bulletin and linked to the programs.
 */
export function useConfirmProductUpdate(update: ProductUpdate) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ programIds, draftFor, accepted }: { programIds: string[]; draftFor: string[]; accepted: UpdateChange[] }) => {
      const save = await db()
        .from('product_updates')
        .update({ program_ids: programIds, ...(update.proposal && { proposal: { ...update.proposal, accepted: accepted.map((c) => c.id) } }) })
        .eq('id', update.id)
        .eq('status', 'pending_review')
        .select('id')
      if (unwrap<{ id: string }[]>(save).length === 0) throw new Error('This update was already decided, or only owners and admins can confirm it.')
      const drafts = await Promise.all(
        draftFor.map(async (programId) => {
          const { program, documentId } = await programAsReading(programId)
          const { program: changed } = applyChanges(program, accepted.filter((c) => c.programId === programId))
          const mine = accepted.filter((c) => c.programId === programId && c.kind !== 'text')
          const reading: MatrixReading = {
            programs: [changed],
            effectiveDate: update.proposal?.effectiveDate ?? null,
            notes: `From the ${update.lenderName ?? 'lender'} email of ${new Date(`${update.receivedOn}T12:00:00`).toLocaleDateString('en-US')}${update.subject ? ` ("${update.subject}")` : ''}.${mine.length ? ` Changes applied: ${mine.map((c) => c.summary).join('; ')}.` : ' No changes applied yet: make them by hand.'}`,
            dropped: [],
          }
          return { program_id: programId, document_id: documentId, reading }
        }),
      )
      return unwrap<{ document_id: string; import_ids: string[] }>(await db().rpc('confirm_product_update', { p_update_id: update.id, p_drafts: drafts }))
    },
    onSuccess: () => refresh(queryClient, update.id),
  })
}

export function useDiscardProductUpdate(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const rows = unwrap<{ id: string }[]>(await db().from('product_updates').update({ status: 'discarded', decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending_review').select('id'))
      if (rows.length === 0) throw new Error('This update was already decided, or only owners and admins can discard it.')
    },
    onSuccess: () => refresh(queryClient, id),
  })
}
