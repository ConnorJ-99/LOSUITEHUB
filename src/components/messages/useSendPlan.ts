import { useEffect, useState } from 'react'
import { useGhlLinks, useMessagingSettings } from '@/lib/api/ghl'
import type { FilePerson } from '@/lib/api/messages'
import type { LoanProfile } from '@/lib/api/types'
import { planSend, sendWindow, type SendPlan } from '../../../supabase/functions/ghl/sendRules'

/**
 * What stands in the way of a text or email to this person, from the same
 * rules the server checks again on send (sendRules.ts). The clock refreshes
 * every minute for the sending-hours chip. Null until settings load.
 * sender: the file's LO Assistant sending from their own GHL number (Connor,
 * 2026-11-17); otherwise it goes from the file's loan officer.
 */
export function useSendPlan(loan: LoanProfile, sender: { id: string; name: string } | null = null) {
  const settings = useMessagingSettings()
  const links = useGhlLinks()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const s = settings.data
  if (!s) return null
  const lo = sender ?? loan.assignedLo
  const link = lo ? links.data?.find((l) => l.profileId === lo.id) : undefined
  const plan = (person: FilePerson, channel: 'text' | 'email', body: string, subject: string | null): SendPlan =>
    planSend({
      channel,
      body,
      subject,
      person: {
        firstName: person.firstName,
        lastName: person.lastName,
        phone: person.phone,
        email: person.email,
        smsConsent: person.smsConsent,
        emailConsent: person.emailConsent,
        smsOptedOutAt: person.smsOptedOutAt,
        emailOptedOutAt: person.emailOptedOutAt,
      },
      testMode: s.testMode,
      hours: s.sendHours,
      now,
      lo: lo ? { name: lo.name, ghlNumber: link?.ghlNumber ?? null, numberConfirmed: !!link?.numberConfirmedAt, ghlEmail: link?.ghlEmail ?? null } : null,
      emailDomainVerified: s.emailDomainVerified,
    })
  return { plan, window: sendWindow(s.sendHours, now), testMode: s.testMode, loName: loan.assignedLo?.name ?? null, fromName: lo?.name ?? null }
}
