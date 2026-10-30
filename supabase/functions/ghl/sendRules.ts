// The rules every send from LOSuite must pass (Phase 3, Connor 2026-10-29).
// The "ghl" Edge Function checks them on the server before each send; the
// Messages tab uses the same code to show what's in the way before you click.
// Pure and import-free, so it's tested here and pasted with index.ts.
//
// - Consent: the channel's consent is on and nobody opted out (STOP or GHL's
//   Do Not Disturb). Only a person turns consent on, with a note.
// - Sending hours, in Central time (messaging_settings.send_hours; default
//   Mon–Sat 9am–9pm, Sun noon–9pm). Outside them nothing sends.
// - Test mode (inbound_mode = 'test_only'): only people with TEST in their
//   LOSuite name.
// - Sender: texts only from the assigned loan officer's own GHL number, once
//   GHL confirms it's theirs. Email from the LO's own address when
//   mps.mortgage is verified for sending, else info@mps.mortgage. No company
//   number: a file without a linked LO waits for review.

export const COMPANY_EMAIL = 'info@mps.mortgage'
export const SEND_TIME_ZONE = 'America/Chicago'
/** GHL splits long texts; past this a text is almost certainly a mistake. */
export const MAX_TEXT_LENGTH = 1000

type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
const DAYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export type SendHoursValue = Partial<Record<Day, [string, string] | null>>

const parts = new Intl.DateTimeFormat('en-US', { timeZone: SEND_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The day ("mon") and time ("21:05") in Central time. */
export function centralNow(now: Date): { day: Day; time: string } {
  const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value]))
  return { day: String(p.weekday).toLowerCase().slice(0, 3) as Day, time: `${p.hour}:${p.minute}` }
}

/** "21:00" → "9 PM", "12:30" → "12:30 PM". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${m ? `${hour}:${String(m).padStart(2, '0')}` : hour} ${h < 12 ? 'AM' : 'PM'}`
}

/** Whether a message may go out now, and the plain-English window for the screen. */
export function sendWindow(hours: SendHoursValue, now: Date): { open: boolean; label: string } {
  const { day, time } = centralNow(now)
  const today = hours[day] ?? null
  if (today && time >= today[0] && time < today[1]) return { open: true, label: `OK to send now · until ${clockLabel(today[1])}` }
  // The next time it opens: later today, else the next day with hours.
  if (today && time < today[0]) return { open: false, label: `Outside sending hours · opens ${clockLabel(today[0])}` }
  const start = DAYS.indexOf(day)
  for (let i = 1; i <= 7; i++) {
    const d = DAYS[(start + i) % 7]
    const h = hours[d]
    if (h) return { open: false, label: `Outside sending hours · opens ${i === 1 ? 'tomorrow' : d[0].toUpperCase() + d.slice(1)} ${clockLabel(h[0])}` }
  }
  return { open: false, label: 'Sending hours are turned off every day (Settings → Sending)' }
}

export function hasTestName(firstName: string | null, lastName: string | null): boolean {
  return [firstName, lastName].some((n) => !!n && /\bTEST\b/.test(n))
}

/** +1 and 10 digits for GHL, from any US phone as typed; null if it isn't one. */
export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? `+1${ten}` : null
}

/** A plain-text email body as simple, safe HTML (escaped, line breaks kept). */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export interface SendFacts {
  channel: 'text' | 'email'
  body: string
  subject: string | null
  person: {
    firstName: string | null
    lastName: string | null
    phone: string | null
    email: string | null
    smsConsent: boolean | null
    emailConsent: boolean | null
    smsOptedOutAt: string | null
    emailOptedOutAt: string | null
  }
  testMode: boolean
  hours: SendHoursValue
  now: Date
  /** The file's loan officer, and their GHL link if any. */
  lo: { name: string; ghlNumber: string | null; numberConfirmed: boolean; ghlEmail: string | null } | null
  emailDomainVerified: boolean
}

export interface SendPlan {
  /** Everything in the way, in plain English. Empty = it can go. */
  problems: string[]
  to: string | null
  fromNumber: string | null
  fromEmail: string | null
}

/** Checks one message against every rule and works out who it goes to and from. */
export function planSend(f: SendFacts): SendPlan {
  const problems: string[] = []
  const p = f.person
  const first = p.firstName?.trim() || 'This person'
  const body = f.body.trim()

  if (f.testMode && !hasTestName(p.firstName, p.lastName)) problems.push('Test mode: LOSuite only sends to people with TEST in their name.')
  if (!body) problems.push('Write a message first.')

  let to: string | null = null
  let fromNumber: string | null = null
  let fromEmail: string | null = null
  if (f.channel === 'text') {
    to = e164(p.phone)
    if (!to) problems.push(`${first} has no 10-digit mobile number.`)
    if (p.smsOptedOutAt) problems.push(`${first} opted out of texts. Only "Restore texting" with a note turns it back on.`)
    else if (p.smsConsent !== true) problems.push(`${first} has no text consent on file. Record it first (with how they agreed).`)
    if (body.length > MAX_TEXT_LENGTH) problems.push(`Texts are limited to ${MAX_TEXT_LENGTH} characters here (this one is ${body.length}).`)
    if (!f.lo) problems.push('This file has no loan officer, so it waits for an admin to review.')
    else if (!f.lo.ghlNumber || !f.lo.numberConfirmed) problems.push(`${f.lo.name} isn't linked to a confirmed GHL number yet (Settings → GoHighLevel), so it waits for review.`)
    else fromNumber = f.lo.ghlNumber
  } else {
    to = p.email?.trim() || null
    if (!to) problems.push(`${first} has no email address.`)
    if (p.emailOptedOutAt) problems.push(`${first} opted out of email. Only "Restore email" with a note turns it back on.`)
    else if (p.emailConsent !== true) problems.push(`${first} has no email consent on file. Record it first (with how they agreed).`)
    if (!f.subject?.trim()) problems.push('An email needs a subject.')
    if (!f.lo) problems.push('This file has no loan officer, so it waits for an admin to review.')
    else if (!f.lo.ghlNumber || !f.lo.numberConfirmed) problems.push(`${f.lo.name} isn't linked to GHL yet (Settings → GoHighLevel), so it waits for review.`)
    else fromEmail = f.emailDomainVerified && f.lo.ghlEmail ? f.lo.ghlEmail : COMPANY_EMAIL
  }

  const window = sendWindow(f.hours, f.now)
  if (!window.open) problems.push(`${window.label}. Nothing sends outside them (Settings → Sending).`)
  return { problems, to, fromNumber, fromEmail }
}
