import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import type { Milestone, StepMark, StepTemplate } from '@/lib/loanfile/workflow'
import type { FieldChanges } from '@/lib/loanfile/urla'
import { db, keys, unwrap } from './client'
import { reassignLoan, saveLoanDetails } from './loans'
import { toSnake } from './urla'

export type TeamRole = 'processor' | 'lender_ae' | 'title' | 'escrow_officer' | 'buyer_agent' | 'listing_agent'

export interface TeamMemberRecord {
  id: string
  role: TeamRole
  profileId: string | null
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

interface TemplateRow {
  key: string
  name: string
  step_group: StepTemplate['group']
  owner: StepTemplate['owner']
  purposes: string[] | null
  sort_order: number
  requires: string[]
  rule_key: string | null
  milestone: Milestone | null
  action_label: string | null
  action_target: string | null
}

/** The company's workflow step templates (Settings). */
export function useStepTemplates() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: keys.stepTemplates,
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StepTemplate[]> =>
      unwrap<TemplateRow[]>(await db().from('step_templates').select('*').eq('organization_id', orgId!).eq('active', true).order('sort_order')).map((r) => ({
        key: r.key,
        name: r.name,
        group: r.step_group,
        owner: r.owner,
        purposes: r.purposes,
        sortOrder: r.sort_order,
        requires: r.requires,
        ruleKey: r.rule_key,
        milestone: r.milestone,
        actionLabel: r.action_label,
        actionTarget: r.action_target,
      })),
  })
}

export interface LoanFileData {
  milestones: { milestone: Milestone; reachedOn: string }[]
  marks: StepMark[]
  team: TeamMemberRecord[]
}

/** A file's reached milestones, marked steps and assigned team. */
export function useLoanFile(loanId: string) {
  return useQuery({
    queryKey: keys.loanFile(loanId),
    queryFn: async (): Promise<LoanFileData> => {
      const [milestones, steps, team] = await Promise.all([
        db().from('loan_milestones').select('milestone, reached_on').eq('loan_id', loanId),
        db().from('loan_steps').select('step_key, status, done_on').eq('loan_id', loanId),
        db().from('loan_team_members').select('id, role, profile_id, name, company, email, phone').eq('loan_id', loanId),
      ])
      return {
        milestones: unwrap<{ milestone: Milestone; reached_on: string }[]>(milestones).map((m) => ({ milestone: m.milestone, reachedOn: m.reached_on })),
        marks: unwrap<{ step_key: string; status: 'done' | 'na'; done_on: string | null }[]>(steps).map((s) => ({ stepKey: s.step_key, status: s.status, doneOn: s.done_on })),
        team: unwrap<{ id: string; role: TeamRole; profile_id: string | null; name: string | null; company: string | null; email: string | null; phone: string | null }[]>(team).map((t) => ({
          id: t.id,
          role: t.role,
          profileId: t.profile_id,
          name: t.name,
          company: t.company,
          email: t.email,
          phone: t.phone,
        })),
      }
    },
  })
}

function useInvalidateFile(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    // A milestone can move the stage, which shows on the header, pipeline and history.
    for (const key of [keys.loanFile(loanId), keys.loan(loanId), keys.pipeline, keys.stageHistory(loanId), keys.today]) queryClient.invalidateQueries({ queryKey: key })
  }
}

/**
 * Marks a step done (with a date) or not applicable, or clears it. Marking a
 * milestone step done records the milestone, which moves the file's stage
 * forward in the database. Clearing a milestone step removes its milestone
 * (the stage never moves backward on its own).
 */
export function useMarkStep(loanId: string, organizationId: string) {
  const invalidate = useInvalidateFile(loanId)
  return useMutation({
    mutationFn: async ({ step, status, doneOn }: { step: StepTemplate; status: 'done' | 'na' | null; doneOn?: string }) => {
      if (status === null) {
        unwrap(await db().from('loan_steps').delete().eq('loan_id', loanId).eq('step_key', step.key))
        // Undoing a milestone step un-reaches the milestone; the stage stays where it is (change it with Change status).
        if (step.milestone) unwrap(await db().from('loan_milestones').delete().eq('loan_id', loanId).eq('milestone', step.milestone))
        return
      }
      unwrap(
        await db()
          .from('loan_steps')
          .upsert({ loan_id: loanId, organization_id: organizationId, step_key: step.key, status, done_on: status === 'done' ? doneOn : null }, { onConflict: 'loan_id,step_key' })
          .select('step_key'),
      )
      if (status === 'done' && step.milestone) {
        unwrap(
          await db()
            .from('loan_milestones')
            .upsert({ loan_id: loanId, organization_id: organizationId, milestone: step.milestone, reached_on: doneOn }, { onConflict: 'loan_id,milestone', ignoreDuplicates: true })
            .select('milestone'),
        )
      }
    },
    onSettled: invalidate,
  })
}

/** Assigns (or clears, with null) one team role on a file: a company user or an outside contact by name. */
export function useSaveTeamMember(loanId: string, organizationId: string) {
  const invalidate = useInvalidateFile(loanId)
  return useMutation({
    mutationFn: async ({ role, member }: { role: TeamRole; member: { profileId?: string | null; name?: string | null; company?: string | null } | null }) => {
      if (!member) {
        unwrap(await db().from('loan_team_members').delete().eq('loan_id', loanId).eq('role', role))
        return
      }
      unwrap(
        await db()
          .from('loan_team_members')
          .upsert(
            { loan_id: loanId, organization_id: organizationId, role, profile_id: member.profileId ?? null, name: member.name?.trim() || null, company: member.company?.trim() || null },
            { onConflict: 'loan_id,role' },
          )
          .select('id'),
      )
    },
    onSettled: invalidate,
  })
}

/** Changes the file's loan officer (the Assigned LO). */
export function useSetLoanOfficer(loanId: string) {
  const invalidate = useInvalidateFile(loanId)
  return useMutation({
    mutationFn: async (profileId: string | null) => {
      await reassignLoan(loanId, profileId)
    },
    onSettled: invalidate,
  })
}

/**
 * Saves the "Complete fields" card: each value goes to its own record (the
 * loan, a property, a person, a job, declarations), the same places the
 * 1003 edits. Only filled-in values are written.
 */
export function useSaveMissingFields(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (c: FieldChanges) => {
      const check = (label: string, result: { error: { message: string } | null }) => {
        if (result.error) throw new Error(`${label}: ${result.error.message}`)
      }
      await saveLoanDetails(loanId, c.loan)
      for (const [id, fields] of Object.entries(c.properties)) check('Saving the property', await db().from('properties').update(snake(fields)).eq('id', id).select('id'))
      for (const [id, fields] of Object.entries(c.people)) check('Saving the borrower', await db().from('contacts').update(snake(fields)).eq('id', id).select('id'))
      for (const [contactId, score] of Object.entries(c.scores)) {
        check('Saving the credit score', await db().from('loan_borrowers').update({ estimated_credit_score: score }).eq('loan_id', loanId).eq('contact_id', contactId).select('contact_id'))
      }
      for (const [id, fields] of Object.entries(c.jobs)) check('Saving the job', await db().from('employments').update(snake(fields)).eq('id', id).select('id'))
      for (const [contactId, fields] of Object.entries(c.declarations)) {
        check('Saving declarations', await db().from('borrower_declarations').upsert({ ...snake(fields), loan_id: loanId, contact_id: contactId }, { onConflict: 'loan_id,contact_id' }).select('loan_id'))
      }
    },
    onSettled: () => {
      for (const key of [keys.application(loanId), keys.loan(loanId), keys.properties(loanId), keys.loanFile(loanId), keys.pipeline]) queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

const snake = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [toSnake(k), v]))
