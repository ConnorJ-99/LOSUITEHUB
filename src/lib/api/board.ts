// The pipeline overview and boards' data (Pipeline redesign, Connor
// 2026-11-13): every visible file (the pipeline query) joined with the facts a
// card needs (occupancy, loan type facts, dates, the home, Arive #), its step
// and lead type, and its next open task. Steps and lead types are read on
// their own, so the pages work before the pipeline redesign script has run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CardFile } from '@/lib/pipeline/card'
import type { LeadTypeId } from '@/lib/pipeline/leadType'
import { db, keys, num, unwrap } from './client'
import { useLoanNumberIndex } from './loanNumbers'
import { usePipeline } from './loans'
import { useOpenTasks } from './tasks'
import type { PipelineLoan, Task } from './types'

interface FactsRow {
  id: string
  occupancy: string | null
  mortgage_type: string | null
  income_doc_type: string | null
  contract_date: string | null
  preapproval_expires_on: string | null
  preapproval_max_price: unknown
  arive_loan_number: string | null
  program: { product_family: string } | null
  home: { address_line: string; city: string | null; estimated_value: unknown } | null
}

// Under ['pipeline'] so anything that refreshes the pipeline (a stage move) refreshes these too.
const factsKey = ['pipeline', 'facts'] as const
const stepsKey = ['pipeline', 'steps'] as const

function useCardFacts() {
  return useQuery({
    queryKey: factsKey,
    queryFn: async () => {
      const rows = unwrap<FactsRow[]>(
        await db()
          .from('loans')
          .select(
            'id, occupancy, mortgage_type, income_doc_type, contract_date, preapproval_expires_on, preapproval_max_price, arive_loan_number, program:programs!loans_program_id_fkey ( product_family ), home:properties!loans_subject_property_id_fkey ( address_line, city, estimated_value )',
          ),
      )
      return new Map(rows.map((r) => [r.id, r]))
    },
  })
}

/** Each file's step and lead type; null before the pipeline redesign script has run. */
function useCardSteps() {
  return useQuery({
    queryKey: stepsKey,
    retry: false,
    queryFn: async () => {
      const r = await db().from('loans').select('id, lead_type, current_step')
      if (r.error) return null
      return new Map((r.data as { id: string; lead_type: string | null; current_step: number }[]).map((x) => [x.id, x]))
    },
  })
}

/** A file on the overview or a board: the card's facts plus what the page shows around it. */
export interface BoardFile extends CardFile {
  loan: PipelineLoan
  name: string
  address: string | null
  ariveLoanNumber: string | null
  /** Arive #, lender loan # and title GF #, for search. */
  loanNumbers: string[]
  nextTask: Task | null
}

export function useBoardFiles() {
  const pipeline = usePipeline()
  const facts = useCardFacts()
  const steps = useCardSteps()
  const tasks = useOpenTasks()
  const numbers = useLoanNumberIndex()
  const loading = pipeline.isLoading || facts.isLoading || steps.isLoading
  const files: BoardFile[] | undefined =
    pipeline.data && facts.data
      ? pipeline.data.map((l) => {
          const f = facts.data!.get(l.id)
          const s = steps.data?.get(l.id)
          return {
            loan: l,
            id: l.id,
            purpose: l.purpose,
            stage: l.stage,
            stageChangedAt: l.stageChangedAt,
            createdAt: l.createdAt,
            currentStep: s?.current_step ?? 1,
            leadType: s?.lead_type ?? null,
            priority: l.priority,
            onHoldAt: l.onHoldAt,
            occupancy: f?.occupancy ?? null,
            mortgageType: f?.mortgage_type ?? null,
            incomeDocType: f?.income_doc_type ?? null,
            programFamily: f?.program?.product_family ?? null,
            loanAmount: l.loanAmount,
            purchasePrice: l.purchasePrice,
            homeValue: num(f?.home?.estimated_value ?? null),
            maxPrice: num(f?.preapproval_max_price ?? null),
            timeline: l.timeline,
            contractDate: f?.contract_date ?? null,
            closingDate: l.closingDate,
            preapprovalExpiresOn: f?.preapproval_expires_on ?? null,
            name: l.borrower ? `${l.borrower.firstName} ${l.borrower.lastName}`.trim() : 'No borrower',
            address: f?.home ? [f.home.address_line, f.home.city].filter(Boolean).join(', ') : null,
            ariveLoanNumber: f?.arive_loan_number ?? null,
            loanNumbers: numbers.data?.byLoan.get(l.id) ?? (f?.arive_loan_number ? [f.arive_loan_number] : []),
            nextTask: tasks.data?.get(l.id)?.[0] ?? null,
          }
        })
      : undefined
  return { files, loading, error: pipeline.error ?? facts.error, stepsReady: steps.data !== null && steps.data !== undefined }
}

function useBoardMutation<V>(fn: (v: V) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of [stepsKey, keys.pipeline]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** Moves a file to a step inside its stage (the step line on a card). */
export function useSetStep() {
  return useBoardMutation(async ({ id, step }: { id: string; step: number }) => {
    const r = await db().from('loans').update({ current_step: step }).eq('id', id).select('id')
    if (r.error) throw new Error(/current_step/.test(r.error.message) ? 'Run the pipeline redesign script in Supabase first.' : r.error.message)
    if (!r.data?.length) throw new Error('You do not have permission to change this file.')
  })
}

/** Sets the card's loan type (null = work it out from the file again). */
export function useSetLeadType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, leadType }: { id: string; leadType: LeadTypeId | null }) => {
      const r = await db().from('loans').update({ lead_type: leadType }).eq('id', id).select('id')
      if (r.error) throw new Error(/lead_type/.test(r.error.message) ? 'Run the pipeline redesign script in Supabase first.' : r.error.message)
      if (!r.data?.length) throw new Error('You do not have permission to change this file.')
    },
    onSettled: (_d, _e, v) => {
      for (const k of [stepsKey, keys.loan(v.id)]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}

/** The card facts refresh with the pipeline (a stage move changes them). */
export const BOARD_KEYS = [factsKey, stepsKey]

/** One file's lead type as set (null = automatic), for the profile's picker; no data before the script has run. */
export function useLoanLeadType(loanId: string) {
  return useQuery({
    queryKey: [...stepsKey, loanId],
    retry: false,
    queryFn: async () => {
      const r = await db().from('loans').select('lead_type').eq('id', loanId).maybeSingle()
      // Before the script (no column) or offline: the picker stays hidden (no data).
      if (r.error) throw new Error(r.error.message)
      return ((r.data as { lead_type: string | null } | null)?.lead_type ?? null) as LeadTypeId | null
    },
  })
}
