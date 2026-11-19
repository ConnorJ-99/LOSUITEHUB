import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { db } from './client'

// Appointments booked from MPS HQ (Connor, 2026-11-18; `appointments`, written
// only by the ghl function). Read on their own: before the appointments
// script has run, these come back empty and the cards stay hidden.

export interface Appointment {
  id: string
  loanId: string
  contactId: string
  contactName: string
  loUserId: string | null
  title: string
  notes: string | null
  startsAt: string
  endsAt: string
  status: 'booked' | 'cancelled'
}

interface Row {
  id: string
  loan_id: string
  contact_id: string
  lo_user_id: string | null
  title: string
  notes: string | null
  starts_at: string
  ends_at: string
  status: 'booked' | 'cancelled'
  contact: { first_name: string | null; last_name: string | null } | null
}

const SELECT = 'id, loan_id, contact_id, lo_user_id, title, notes, starts_at, ends_at, status, contact:contacts ( first_name, last_name )'

const notInstalled = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? ''))

const toAppointment = (r: Row): Appointment => ({
  id: r.id,
  loanId: r.loan_id,
  contactId: r.contact_id,
  contactName: [r.contact?.first_name, r.contact?.last_name].filter(Boolean).join(' ') || 'Borrower',
  loUserId: r.lo_user_id,
  title: r.title,
  notes: r.notes,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  status: r.status,
})

/** Every appointment on a file (the file rule decides who sees them). */
export function useFileAppointments(loanId: string) {
  return useQuery({
    queryKey: ['appointments', 'file', loanId],
    queryFn: async (): Promise<Appointment[]> => {
      const { data, error } = await db().from('appointments').select(SELECT).eq('loan_id', loanId).order('starts_at')
      if (notInstalled(error)) return []
      if (error) throw new Error(error.message)
      return (data as unknown as Row[]).map(toAppointment)
    },
  })
}

/** Your appointments (on your calendar, or that you booked) from now through the next `days` days, for Today. */
export function useMyAppointments(days = 7) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: ['appointments', 'mine', me, days],
    enabled: !!me,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async (): Promise<Appointment[]> => {
      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const to = new Date(Date.now() + days * 86_400_000).toISOString()
      const { data, error } = await db()
        .from('appointments')
        .select(SELECT)
        .eq('status', 'booked')
        .or(`lo_user_id.eq.${me},booked_by.eq.${me}`)
        .gte('ends_at', from)
        .lte('starts_at', to)
        .order('starts_at')
      if (notInstalled(error)) return []
      if (error) throw new Error(error.message)
      return (data as unknown as Row[]).map(toAppointment)
    },
  })
}
