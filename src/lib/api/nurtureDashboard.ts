// What the Nurture dashboard reads (Connor, 2026-11-16; buyer-nurture Step 9).
// Every query goes through the file rule (RLS), so a loan officer sees their
// own files and the Admin login sees every file. Read only.
import { useQuery } from '@tanstack/react-query'
import { exitsFrom, RESPONSE_DAYS, RESPONSE_WINDOW_DAYS, type DashInput } from '@/lib/nurture/dashboard'
import type { NurtureStage } from '@/lib/nurture/obstacles'
import { db, unwrap } from './client'

type Data = Omit<DashInput, 'today' | 'loId'> & { names: [string, string][] }

interface LoanRow {
  id: string
  stage: string
  assigned_lo_id: string | null
  nurture_stage: NurtureStage | null
  nurture_entered_at: string | null
  nurture_obstacles: string[] | null
  nurture_next_follow_up: string | null
  lo: { id: string; full_name: string | null; email: string } | null
  borrowers: { role: string; contact_id: string; contact: { first_name: string | null; last_name: string | null } | null }[]
}

const LOAN_SELECT = 'id, stage, assigned_lo_id, nurture_stage, nurture_entered_at, nurture_obstacles, nurture_next_follow_up, lo:profiles!loans_assigned_lo_id_fkey ( id, full_name, email ), borrowers:loan_borrowers ( role, contact_id, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) )'
const nameOf = (l: LoanRow) => {
  const p = l.borrowers.find((b) => b.role === 'primary') ?? l.borrowers[0]
  return [p?.contact?.first_name, p?.contact?.last_name].filter(Boolean).join(' ') || 'Borrower'
}
const chunks = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** Everything the dashboard needs; null before the nurture scripts have run. */
export function useNurtureDashboardData() {
  return useQuery({
    queryKey: ['pipeline', 'nurtureDashboard'],
    retry: false,
    queryFn: async (): Promise<Data | null> => {
      const now = await db().from('loans').select(LOAN_SELECT).eq('stage', 'nurture')
      if (now.error) return null
      const current = now.data as unknown as LoanRow[]
      const since = new Date(Date.now() - RESPONSE_WINDOW_DAYS * 86_400_000).toISOString()

      const [hist, checks] = await Promise.all([
        db().from('loan_stage_history').select('loan_id, from_stage, to_stage, changed_at').or('from_stage.eq.nurture,to_stage.eq.nurture').order('changed_at').limit(5000),
        db().from('action_items').select('loan_id, payload, sent_at').eq('source', 'nurture_milestone').not('sent_at', 'is', null).gte('sent_at', since).limit(2000),
      ])
      const history = unwrap<{ loan_id: string; from_stage: string | null; to_stage: string; changed_at: string }[]>(hist)
      const checkRows = (checks.data ?? []) as { loan_id: string; payload: { nurture?: { kind?: string } }; sent_at: string }[]

      // Files that were ever in Nurture and have left: their stage now and loan officer.
      const pastIds = [...new Set(history.filter((h) => h.from_stage === 'nurture').map((h) => h.loan_id))]
      const past: LoanRow[] = []
      for (const ids of chunks(pastIds)) past.push(...(unwrap<unknown[]>(await db().from('loans').select(LOAN_SELECT).in('id', ids)) as LoanRow[]))
      const loans = new Map([...current, ...past].map((l) => [l.id, { loId: l.assigned_lo_id, stageNow: l.stage }]))

      const ids = current.map((l) => l.id)
      const plans: DashInput['plans'] = []
      const milestones: DashInput['milestones'] = []
      const delivered = new Set<string>()
      const openUpdates = new Map<string, number>()
      for (const part of chunks(ids)) {
        const [p, m, log, u] = await Promise.all([
          db().from('readiness_plans').select('loan_id, status').in('loan_id', part),
          db().from('readiness_milestones').select('loan_id, action_id, status, target_date, plan:readiness_plans!inner ( status )').in('loan_id', part).eq('plan.status', 'approved'),
          db().from('loan_change_log').select('loan_id').in('loan_id', part).eq('field', 'nurture_stage').eq('new_value', 'plan_delivered'),
          db().from('nurture_updates').select('loan_id').in('loan_id', part).in('status', ['queued', 'unverified']),
        ])
        for (const r of (p.data ?? []) as { loan_id: string; status: DashInput['plans'][number]['status'] }[]) plans.push({ loanId: r.loan_id, status: r.status })
        for (const r of (m.data ?? []) as { loan_id: string; action_id: string | null; status: string; target_date: string | null }[]) milestones.push({ loanId: r.loan_id, onAction: !!r.action_id, done: r.status === 'done', targetDate: r.target_date })
        for (const r of (log.data ?? []) as { loan_id: string }[]) delivered.add(r.loan_id)
        for (const r of (u.data ?? []) as { loan_id: string }[]) openUpdates.set(r.loan_id, (openUpdates.get(r.loan_id) ?? 0) + 1)
      }

      // Replies: the borrowers on files that got check-ins, written in after the window began.
      const inbound = new Map<string, string[]>()
      const checkedLoans = [...new Set(checkRows.map((c) => c.loan_id))]
      if (checkedLoans.length) {
        const people = new Map<string, string[]>()
        for (const part of chunks(checkedLoans)) {
          for (const b of unwrap<{ loan_id: string; contact_id: string }[]>(await db().from('loan_borrowers').select('loan_id, contact_id').in('loan_id', part))) people.set(b.contact_id, [...(people.get(b.contact_id) ?? []), b.loan_id])
        }
        for (const part of chunks([...people.keys()])) {
          const msgs = unwrap<{ contact_id: string; sent_at: string }[]>(await db().from('messages').select('contact_id, sent_at').eq('direction', 'inbound').in('contact_id', part).gte('sent_at', since).limit(5000))
          for (const msg of msgs) for (const loanId of people.get(msg.contact_id) ?? []) inbound.set(loanId, [...(inbound.get(loanId) ?? []), msg.sent_at])
        }
      }

      const names = new Map<string, string>()
      for (const l of [...current, ...past]) if (l.lo) names.set(l.lo.id, l.lo.full_name || l.lo.email)
      return {
        files: current.map((l) => ({ loanId: l.id, borrower: nameOf(l), loId: l.assigned_lo_id, stage: l.nurture_stage, enteredAt: l.nurture_entered_at, obstacles: l.nurture_obstacles ?? [], nextFollowUp: l.nurture_next_follow_up })),
        plans,
        milestones,
        delivered,
        openUpdates,
        checkIns: checkRows.map((c) => ({ loanId: c.loan_id, kind: c.payload?.nurture?.kind ?? '', sentAt: c.sent_at })),
        inbound,
        exits: exitsFrom(history.map((h) => ({ loanId: h.loan_id, from: h.from_stage, to: h.to_stage, at: h.changed_at })), loans),
        names: [...names.entries()],
      }
    },
  })
}

export { RESPONSE_DAYS, RESPONSE_WINDOW_DAYS }
