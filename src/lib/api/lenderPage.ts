// Data for one lender's page (mockup 09): contacts, overlays, your files with
// the lender, and its matrix versions for "last matrix update".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { fullName } from '@/lib/pipeline/helpers'
import type { ProgramVersions } from '@/lib/products/lenderDetail'
import type { ReadRule } from '../../../supabase/functions/assistant/matrix'
import { db, keys, unwrap } from './client'
import { readAll, toCell, type CellRow } from './products'

// ---------------------------------------------------------------------------
// Contacts (the account executive stays on the lender)
// ---------------------------------------------------------------------------

export interface LenderContact {
  id: string | null
  name: string
  role: string
  phone: string | null
  email: string | null
  notes: string | null
}

export const CONTACT_ROLES = ['Scenario desk', 'Broker support', 'Underwriting', 'Closing', 'Account manager', 'Other'] as const

const contactsKey = (lenderId: string) => ['lenderContacts', lenderId] as const

export function useLenderContacts(lenderId: string) {
  return useQuery({
    queryKey: contactsKey(lenderId),
    queryFn: async () =>
      unwrap<{ id: string; name: string; role: string; phone: string | null; email: string | null; notes: string | null }[]>(
        await db().from('lender_contacts').select('id, name, role, phone, email, notes').eq('lender_id', lenderId).order('sort_order').order('name'),
      ) as LenderContact[],
  })
}

export function useSaveLenderContact(lenderId: string) {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (c: LenderContact) => {
      if (!c.name.trim()) throw new Error('Give the contact a name.')
      const row = { name: c.name.trim(), role: c.role.trim() || 'Other', phone: c.phone?.trim() || null, email: c.email?.trim() || null, notes: c.notes?.trim() || null }
      const result = c.id ? await db().from('lender_contacts').update(row).eq('id', c.id).select('id') : await db().from('lender_contacts').insert({ ...row, organization_id: orgId, lender_id: lenderId }).select('id')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('Only owners and admins can change lender contacts.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactsKey(lenderId) }),
  })
}

export function useDeleteLenderContact(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (unwrap<{ id: string }[]>(await db().from('lender_contacts').delete().eq('id', id).select('id')).length === 0) throw new Error('Only owners and admins can remove lender contacts.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactsKey(lenderId) }),
  })
}

// ---------------------------------------------------------------------------
// Overlays: your own stricter rules for this lender or one of its programs
// ---------------------------------------------------------------------------

export interface LenderOverlay {
  id: string
  programId: string | null
  message: string
  severity: 'hard' | 'verify'
  active: boolean
}

const overlaysKey = (lenderId: string) => ['lenderOverlays', lenderId] as const

export function useLenderOverlays(lenderId: string, programIds: string[]) {
  return useQuery({
    queryKey: [...overlaysKey(lenderId), programIds.join(',')],
    queryFn: async () => {
      const or = [`lender_id.eq.${lenderId}`, ...(programIds.length ? [`program_id.in.(${programIds.join(',')})`] : [])].join(',')
      return unwrap<{ id: string; program_id: string | null; message: string; severity: 'hard' | 'verify'; active: boolean }[]>(
        await db().from('overlays').select('id, program_id, message, severity, active').in('scope', ['lender', 'program']).or(or).order('created_at'),
      ).map((o): LenderOverlay => ({ id: o.id, programId: o.program_id, message: o.message, severity: o.severity, active: o.active }))
    },
  })
}

function invalidateOverlays(queryClient: ReturnType<typeof useQueryClient>, lenderId: string) {
  queryClient.invalidateQueries({ queryKey: overlaysKey(lenderId) })
  queryClient.invalidateQueries({ queryKey: keys.catalog })
}

/** Adds an overlay for the whole lender (programId null) or one program. Product Search applies it from then on. */
export function useAddOverlay(lenderId: string) {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ rule, programId }: { rule: ReadRule; programId: string | null }) => {
      const row = { organization_id: orgId, scope: programId ? 'program' : 'lender', lender_id: programId ? null : lenderId, program_id: programId, field: rule.field, op: rule.op, value: rule.value, applies_when: rule.appliesWhen, severity: rule.severity, message: rule.message }
      if (unwrap<{ id: string }[]>(await db().from('overlays').insert(row).select('id')).length === 0) throw new Error('Only owners and admins can add overlays.')
    },
    onSuccess: () => invalidateOverlays(queryClient, lenderId),
  })
}

export function useSetOverlayActive(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (unwrap<{ id: string }[]>(await db().from('overlays').update({ active }).eq('id', id).select('id')).length === 0) throw new Error('Only owners and admins can change overlays.')
    },
    onSuccess: () => invalidateOverlays(queryClient, lenderId),
  })
}

export function useDeleteOverlay(lenderId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (unwrap<{ id: string }[]>(await db().from('overlays').delete().eq('id', id).select('id')).length === 0) throw new Error('Only owners and admins can remove overlays.')
    },
    onSuccess: () => invalidateOverlays(queryClient, lenderId),
  })
}

// ---------------------------------------------------------------------------
// Your files with this lender
// ---------------------------------------------------------------------------

export interface LenderFile {
  loanId: string
  borrowerName: string
  stage: string
  programName: string
  loanAmount: number | null
  closingDate: string | null
  applicationOn: string | null
  closedOn: string | null
}

/** Files where you chose one of this lender's programs (Row Level Security limits them to files you can see). */
export function useLenderFiles(lenderId: string) {
  return useQuery({
    queryKey: ['lenderLoans', lenderId],
    queryFn: async () => {
      const rows = unwrap<
        {
          program: { name: string; lender_id: string }
          loan: {
            id: string
            stage: string
            loan_amount: unknown
            closing_date: string | null
            milestones: { milestone: string; reached_on: string }[]
            borrowers: { role: string; contact: { first_name: string; last_name: string } | null }[]
          } | null
        }[]
      >(
        await db()
          .from('loan_program_options')
          .select('program:programs!loan_program_options_program_id_fkey!inner(name, lender_id), loan:loans!loan_program_options_loan_id_fkey(id, stage, loan_amount, closing_date, milestones:loan_milestones(milestone, reached_on), borrowers:loan_borrowers(role, contact:contacts!loan_borrowers_contact_id_fkey(first_name, last_name)))')
          .eq('status', 'chosen')
          .eq('program.lender_id', lenderId),
      )
      return rows.flatMap((r): LenderFile[] => {
        if (!r.loan) return []
        const primary = r.loan.borrowers.find((b) => b.role === 'primary')?.contact
        const on = (m: string) => r.loan!.milestones.find((x) => x.milestone === m)?.reached_on ?? null
        return [
          {
            loanId: r.loan.id,
            borrowerName: primary ? fullName({ firstName: primary.first_name, lastName: primary.last_name }) : 'No borrower',
            stage: r.loan.stage,
            programName: r.program.name,
            loanAmount: r.loan.loan_amount == null ? null : Number(r.loan.loan_amount),
            closingDate: r.loan.closing_date,
            applicationOn: on('application'),
            closedOn: on('closed') ?? on('funded') ?? (r.loan.stage === 'closed' ? r.loan.closing_date : null),
          },
        ]
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Matrix versions (for "last matrix update")
// ---------------------------------------------------------------------------

/** Each program's approved matrix and the version it replaced, with their cells. */
export function useLenderMatrixVersions(lenderId: string) {
  return useQuery({
    queryKey: ['lenderMatrixVersions', lenderId],
    queryFn: async (): Promise<ProgramVersions[]> => {
      const versions = unwrap<{ id: string; program_id: string; version: number; status: string; approved_at: string | null; program: { name: string; lender_id: string } }[]>(
        await db().from('matrix_versions').select('id, program_id, version, status, approved_at, program:programs!matrix_versions_program_id_fkey!inner(name, lender_id)').eq('program.lender_id', lenderId).in('status', ['approved', 'superseded']),
      )
      const byProgram = new Map<string, typeof versions>()
      for (const v of versions) byProgram.set(v.program_id, [...(byProgram.get(v.program_id) ?? []), v])
      const picked = [...byProgram.values()].flatMap((vs) => {
        const current = vs.find((v) => v.status === 'approved')
        if (!current) return []
        const previous = vs.filter((v) => v.status === 'superseded' && v.version < current.version).sort((a, b) => b.version - a.version)[0] ?? null
        return [{ current, previous }]
      })
      const ids = picked.flatMap((p) => [p.current.id, ...(p.previous ? [p.previous.id] : [])])
      const cells = ids.length
        ? await readAll<CellRow>((a, b) =>
            db()
              .from('program_matrix_cells')
              .select('id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, citizenship, offered, max_ltv, max_cltv, max_dti, reserves_months, source_page, notes')
              .in('matrix_version_id', ids)
              .order('id')
              .range(a, b),
          )
        : []
      const cellsOf = (versionId: string) => cells.filter((c) => c.matrix_version_id === versionId).map(toCell)
      return picked.map(({ current, previous }) => ({
        programName: current.program.name,
        current: { version: current.version, approvedAt: current.approved_at, cells: cellsOf(current.id) },
        previous: previous ? { version: previous.version, cells: cellsOf(previous.id) } : null,
      }))
    },
  })
}
