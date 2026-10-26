import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreditEventType } from '@/lib/prequal/readiness'
import { db, keys, num, unwrap } from './client'

/** A bankruptcy, foreclosure, short sale, deed in lieu, late payment or collection. Person facts. */
export interface CreditEvent {
  id: string
  contactId: string
  eventType: CreditEventType
  eventDate: string | null
  daysLate: number | null
  isMortgage: boolean
  amount: number | null
  notes: string | null
}

interface CreditEventRow {
  id: string
  contact_id: string
  event_type: CreditEventType
  event_date: string | null
  days_late: number | null
  is_mortgage: boolean
  amount: unknown
  notes: string | null
}

const toEvent = (r: CreditEventRow): CreditEvent => ({
  id: r.id,
  contactId: r.contact_id,
  eventType: r.event_type,
  eventDate: r.event_date,
  daysLate: r.days_late,
  isMortgage: r.is_mortgage,
  amount: num(r.amount),
  notes: r.notes,
})

/** Credit events for the borrowers on a loan, newest first. */
export function useCreditEvents(loanId: string, contactIds: string[]) {
  return useQuery({
    queryKey: [...keys.creditEvents(loanId), contactIds.join(',')],
    enabled: contactIds.length > 0,
    queryFn: async () =>
      unwrap<CreditEventRow[]>(
        await db().from('credit_events').select('id, contact_id, event_type, event_date, days_late, is_mortgage, amount, notes').in('contact_id', contactIds).order('event_date', { ascending: false, nullsFirst: true }),
      ).map(toEvent),
  })
}

export type CreditEventDraft = Omit<CreditEvent, 'id'> & { id: string | null }

export function useSaveCreditEvent(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (e: CreditEventDraft) => {
      const late = e.eventType === 'late_payment'
      const row = {
        contact_id: e.contactId,
        event_type: e.eventType,
        event_date: e.eventDate || null,
        days_late: late ? e.daysLate : null,
        is_mortgage: late ? e.isMortgage : false,
        amount: e.eventType === 'collection' ? e.amount : null,
        notes: e.notes?.trim() || null,
      }
      if (late && !row.days_late) throw new Error('Pick how many days late.')
      const result = e.id ? await db().from('credit_events').update(row).eq('id', e.id).select('id') : await db().from('credit_events').insert({ ...row, organization_id: organizationId }).select('id')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('You do not have permission to change this.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.creditEvents(loanId) }),
  })
}

export function useDeleteCreditEvent(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('credit_events').delete().eq('id', id).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.creditEvents(loanId) }),
  })
}
