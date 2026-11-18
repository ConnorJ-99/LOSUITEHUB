// Message templates for a file's Messages tab (Connor, 2026-11-17): a realtor
// introduction for a buyer with no agent, plus a few everyday ones. Picking one
// only fills the message box; it is edited and sent with a click through the
// usual send checks. The general templates carry no links in texts; the LO Assistant ones use merge tags (links allowed, Connor 2026-11-17). Pure, tested.

import { applicationLink } from './updates'

export type TemplateId = 'realtor_intro' | 'check_in' | 'document_reminder' | 'application_link' | 'loa_intro' | 'loa_documents' | 'loa_booking'
export type Channel = 'text' | 'email'

export interface TemplateInfo {
  id: TemplateId
  label: string
  hint: string
  /** Only for these channels (application link: email only, since texts carry no links). */
  channels: Channel[]
  /** LO Assistant templates (Connor, 2026-11-17): shown to the file's LO Assistant; written with merge tags filled from the file's loan officer. */
  loa?: boolean
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'realtor_intro', label: 'Realtor introduction', hint: 'For a buyer with no agent: suggest one or more of your realtor partners.', channels: ['text', 'email'] },
  { id: 'check_in', label: 'Checking in', hint: 'A short "anything I can help with?"', channels: ['text', 'email'] },
  { id: 'document_reminder', label: 'Document reminder', hint: "A friendly nudge that we're still waiting on a few documents.", channels: ['text', 'email'] },
  { id: 'application_link', label: 'Application link', hint: 'Your loan application link (needs your NMLS # in Settings).', channels: ['email'] },
  { id: 'loa_intro', label: 'LOA intro + application link', hint: "Introduce yourself as the LO's assistant, with the LO's application link.", channels: ['text', 'email'], loa: true },
  { id: 'loa_documents', label: 'LOA — documents needed', hint: "Point them to this file's document upload link.", channels: ['text', 'email'], loa: true },
  { id: 'loa_booking', label: 'LOA — book a call with LO', hint: "The LO's booking link.", channels: ['text', 'email'], loa: true },
]

export interface RealtorPick {
  name: string
  company: string | null
  phone: string | null
  email: string | null
}

export interface TemplateFacts {
  borrowerFirst: string
  loName: string | null
  /** The loan officer's NMLS #, for the application link. */
  nmls: string | null
  realtors: RealtorPick[]
}

const firstOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || ''
const phoneLine = (phone: string | null | undefined) => {
  const d = (phone ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null
}

/** Why a realtor can't be suggested on this channel (no phone for a text, no email for an email), or null. */
export function realtorMissing(r: { phone: string | null; email: string | null }, channel: Channel): string | null {
  if (channel === 'text' && !phoneLine(r.phone)) return 'No phone'
  if (channel === 'email' && !(r.email ?? '').trim()) return 'No email'
  return null
}

/** "Amy Lee, Keller Williams, (214) 555-0101" (email: plus "amy@kw.com"). */
function realtorLine(r: RealtorPick, channel: Channel): string {
  const parts = [r.name.trim(), r.company?.trim(), phoneLine(r.phone), channel === 'email' ? r.email?.trim() : null].filter(Boolean)
  return parts.join(', ')
}

/**
 * Realtor partners in the order to show them: preferred first, then the
 * Active stage, then the rest, each by name. Realtors only.
 */
export function realtorChoices<P extends { kind: string; name: string; stage?: string; details?: { preferred: boolean } }>(partners: P[]): P[] {
  const rank = (p: P) => (p.details?.preferred ? 0 : p.stage === 'active' ? 1 : 2)
  return partners.filter((p) => p.kind === 'realtor').sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** The filled-in template, or an error saying what's missing. */
export function buildTemplate(id: TemplateId, channel: Channel, f: TemplateFacts): { body: string; subject: string } | { error: string } {
  const hi = `Hi ${firstOf(f.borrowerFirst) || 'there'},`
  const lo = firstOf(f.loName)
  const me = lo ? `this is ${lo} with MPS Mortgage` : 'this is MPS Mortgage'
  const sign = channel === 'email' ? `\n\n${f.loName?.trim() || 'MPS Mortgage'}${f.loName?.trim() ? '\nMPS Mortgage' : ''}` : lo ? ` - ${lo}` : ''
  const gap = channel === 'email' ? '\n\n' : ' '

  if (id === 'realtor_intro') {
    if (f.realtors.length === 0) return { error: 'Pick at least one realtor.' }
    const missing = f.realtors.find((r) => realtorMissing(r, channel))
    if (missing) return { error: `${missing.name} has no ${channel === 'text' ? 'phone' : 'email'} saved.` }
    const one = f.realtors.length === 1
    const lead = one ? "If you don't have a real estate agent yet, here's one I trust and work with often:" : "If you don't have a real estate agent yet, here are a few I trust and work with often:"
    const list = channel === 'email' ? f.realtors.map((r) => `- ${realtorLine(r, channel)}`).join('\n') : f.realtors.map((r) => realtorLine(r, channel)).join('; ')
    const close = one ? "Feel free to reach out to them, or let me know and I'll make the introduction." : "Feel free to reach out to any of them, or let me know and I'll make the introduction."
    const body = channel === 'email' ? `${hi}${gap}${lead}\n\n${list}${gap}${close}${sign}` : `${hi} ${me}. ${lead} ${list}. ${close}${sign}`
    return { body, subject: one ? 'A real estate agent I recommend' : 'Real estate agents I recommend' }
  }
  if (id === 'check_in') {
    const line = "Just checking in to see how things are going. Is there anything I can help with or any questions I can answer?"
    return { body: channel === 'email' ? `${hi}${gap}${line}${sign}` : `${hi} ${me}. ${line}${sign}`, subject: 'Checking in' }
  }
  if (id === 'document_reminder') {
    const line = "Friendly reminder that we're still waiting on a few documents to keep your loan moving. Send them over when you get a chance, and let me know if you have any questions about what's needed."
    return { body: channel === 'email' ? `${hi}${gap}${line}${sign}` : `${hi} ${me}. ${line}${sign}`, subject: 'A few documents still needed' }
  }
  if (id === 'loa_intro' || id === 'loa_documents' || id === 'loa_booking') return loaTemplate(id, channel)
  // application_link
  if (channel === 'text') return { error: 'The application link goes by email only (texts carry no links).' }
  const link = applicationLink(f.nmls)
  if (!link) return { error: 'Add your NMLS # in Settings → My profile to use the application link.' }
  return {
    body: `${hi}${gap}When you're ready, you can start your loan application here:\n${link}${gap}I'll reach out as soon as it comes in.${sign}`,
    subject: 'Your loan application',
  }
}

// LO Assistant templates: merge tags, filled at send time from the FILE's loan officer (mergeTags.ts).
const LOA_HELLO = "Hi {{borrower.first_name}}, this is {{sender.first_name}}, {{lo.first_name}}'s loan officer assistant at MPS Mortgage."
const LOA_SIGN = '\n\n{{sender.first_name}}\nLoan Officer Assistant to {{lo.full_name}}\nMPS Mortgage'

function loaTemplate(id: 'loa_intro' | 'loa_documents' | 'loa_booking', channel: Channel): { body: string; subject: string } {
  const lines = {
    loa_intro: ["Thanks for the call today! Here's {{lo.first_name}}'s secure application so we can get you pre-approved: {{lo.application_link}}", 'Your loan application'],
    loa_documents: ['To keep things moving, you can upload the documents on your list here: {{file.document_upload_link}} Let me know if you have any questions!', 'Documents for your loan'],
    loa_booking: ["You can grab a time on {{lo.first_name}}'s calendar here: {{lo.booking_link}}", 'Book a call with {{lo.first_name}}'],
  }[id]
  return channel === 'email' ? { body: `${LOA_HELLO}\n\n${lines[0]}${LOA_SIGN}`, subject: lines[1] } : { body: `${LOA_HELLO} ${lines[0]}`, subject: lines[1] }
}
