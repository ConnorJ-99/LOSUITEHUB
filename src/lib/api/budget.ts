// My budget from MPS-HQ's side (nurture goals Phase 3; Connor's decision 4,
// 2026-11-24: the loan officer sees the whole budget). Read only: the
// borrower's settings, income and expense items and confirmed entries, per
// person. Only MyHome writes them. Before the script has run, reads come back null.
import { useQuery } from '@tanstack/react-query'
import type { BudgetEntry, BudgetItem } from '@/lib/calc/budget'
import { db } from './client'

export interface PersonBudget {
  contactId: string
  startingCash: number | null
  startingOn: string | null
  monthlySavings: number | null
  items: (BudgetItem & { notes: string | null })[]
  entries: (BudgetEntry & { loggedAt: string })[]
}

const num = (v: unknown) => (v == null ? null : Number(v))

export function useBudgets(contactIds: string[]) {
  return useQuery({
    queryKey: ['budgets', ...[...contactIds].sort()],
    enabled: contactIds.length > 0,
    retry: false,
    queryFn: async (): Promise<PersonBudget[] | null> => {
      const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
      const [s, i, e] = await Promise.all([
        db().from('budget_settings').select('contact_id, starting_cash, starting_on, monthly_savings').in('contact_id', contactIds),
        db().from('budget_items').select('id, contact_id, kind, name, amount, schedule, every_days, next_on, category, notes, paused').in('contact_id', contactIds).is('archived_at', null).order('kind').order('sort_order'),
        db().from('budget_entries').select('id, contact_id, item_id, kind, name, amount, happened_on, planned_on, created_at').in('contact_id', contactIds).is('removed_at', null).gte('happened_on', since).order('happened_on', { ascending: false }).limit(1000),
      ])
      if (s.error || i.error || e.error) return null
      const settings = s.data as { contact_id: string; starting_cash: number | null; starting_on: string | null; monthly_savings: number | null }[]
      const items = i.data as Record<string, unknown>[]
      const entries = e.data as Record<string, unknown>[]
      return contactIds
        .map((contactId) => {
          const st = settings.find((x) => x.contact_id === contactId)
          return {
            contactId,
            startingCash: num(st?.starting_cash),
            startingOn: st?.starting_on ?? null,
            monthlySavings: num(st?.monthly_savings),
            items: items
              .filter((x) => x.contact_id === contactId)
              .map((x) => ({
                id: x.id as string,
                kind: x.kind as BudgetItem['kind'],
                name: x.name as string,
                amount: Number(x.amount),
                schedule: x.schedule as BudgetItem['schedule'],
                everyDays: num(x.every_days),
                nextOn: (x.next_on as string | null) ?? null,
                category: (x.category as string | null) ?? null,
                notes: (x.notes as string | null) ?? null,
                paused: x.paused as boolean,
              })),
            entries: entries
              .filter((x) => x.contact_id === contactId)
              .map((x) => ({
                id: x.id as string,
                itemId: (x.item_id as string | null) ?? null,
                kind: x.kind as BudgetEntry['kind'],
                name: x.name as string,
                amount: Number(x.amount),
                on: x.happened_on as string,
                plannedOn: (x.planned_on as string | null) ?? null,
                loggedAt: x.created_at as string,
              })),
          }
        })
        .filter((b) => b.items.length || b.entries.length || b.startingCash != null || b.monthlySavings != null)
    },
  })
}
