// The first text and email to a new web lead, drafted for Connor to approve
// in the Action Queue. Built from the form (no AI), in his voice, with the
// same compliance limits as every draft: no rates, payments, percentages or
// promises, texts under 320 characters, and the NMLS signature on emails.
// Pure, with no imports (Deno and Vitest share it).

export interface FirstTouchLead {
  firstName: string
  lastName: string
  email: string | null
  /** 10 digits. */
  phone: string | null
  formType: string | null
  purpose: string
}

/** Same shape and wording as the assistant's email signature. */
export interface Signer {
  loName: string | null
  loNmls: string | null
  loPhone: string | null
  companyName: string
  companyNmls: string
}

export interface FirstTouchDraft {
  channel: 'text' | 'email'
  to: string
  subject: string | null
  body: string
}

export function emailSignature(s: Signer): string {
  return [s.loName ? `${s.loName}${s.loNmls ? `, NMLS #${s.loNmls}` : ''}` : null, 'Loan Officer', `${s.companyName}, NMLS #${s.companyNmls}`, s.loPhone].filter(Boolean).join('\n')
}

const formatPhone = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`

/** What they did on the site, in plain words, from the form type and purpose. */
export function whatTheyDid(formType: string | null, purpose: string): string {
  const f = (formType ?? '').toLowerCase()
  if (/home[\s_-]?value|valuation/.test(f)) return 'checking your home value on our site'
  if (/afford|buying[\s_-]?power|max[\s_-]?price/.test(f)) return 'running the numbers on what you can afford'
  if (/quote|calculator|payment/.test(f)) return 'using the calculator on our site'
  if (/listing|open[\s_-]?house/.test(f)) return 'looking at one of the homes on our site'
  if (/refi|cash/.test(f) || purpose.startsWith('refinance')) return 'reaching out about refinancing'
  if (purpose === 'heloc' || purpose === 'heloan') return 'reaching out about your home equity'
  return 'reaching out through our website'
}

/**
 * The text (if there's a phone) and the email (if there's an email). The
 * text asks for a good time to talk; the email says the same with a little
 * more room and the signature.
 */
export function firstTouchDrafts(lead: FirstTouchLead, s: Signer): FirstTouchDraft[] {
  const me = s.loName ? s.loName.split(/\s+/)[0] : null
  const name = `${lead.firstName} ${lead.lastName}`.trim()
  const did = whatTheyDid(lead.formType, lead.purpose)
  const drafts: FirstTouchDraft[] = []
  if (lead.phone) {
    drafts.push({
      channel: 'text',
      to: `${name} · ${formatPhone(lead.phone)}`,
      subject: null,
      body: `Hi ${lead.firstName}, ${me ? `this is ${me} with ${s.companyName}` : `this is ${s.companyName}`}. Thanks for ${did}! When's a good time for a quick call to talk through what you're looking for?`,
    })
  }
  if (lead.email) {
    drafts.push({
      channel: 'email',
      to: `${name} · ${lead.email}`,
      subject: `Thanks for reaching out, ${lead.firstName}`,
      body: [
        `Hi ${lead.firstName},`,
        '',
        `Thanks for ${did}. I'm ${me ?? 'a loan officer'} with ${s.companyName}, and I'd be glad to help.`,
        '',
        "The best next step is a quick call so I can learn what you're looking for and answer your questions. What day and time work for you?",
        '',
        'Thank you,',
        '',
        emailSignature(s),
      ].join('\n'),
    })
  }
  return drafts
}
