// After the open house (Pages Phase 2b): one "thanks for coming" draft per
// visitor who signed in, built from their own answers (no AI), for Connor to
// Send / Edit / Schedule / Dismiss in the Action Queue. Nothing sends on its
// own. Same limits as every draft: no rates, payments, percentages or
// promises; texts stay short. Pure.
import type { DataRow } from '../../../supabase/functions/page-submit/blocks'

export interface ThanksFacts {
  firstName: string
  address: string
  /** Their answers, when the form asked: true / false / null (skipped). */
  preApproved: boolean | null
  withAgent: boolean | null
  loFirstName: string | null
  company: string
}

/** A yes/no answer by the question's wording ("Already pre-approved?"). */
export function yesNo(data: DataRow[], label: RegExp): boolean | null {
  const row = data.find((d) => label.test(d.label))
  return typeof row?.value === 'boolean' ? row.value : null
}

export function thanksFacts(data: DataRow[], firstName: string, address: string, loFirstName: string | null, company = 'MPS Mortgage'): ThanksFacts {
  return { firstName, address, preApproved: yesNo(data, /pre-?approved/i), withAgent: yesNo(data, /working with an agent|have an agent/i), loFirstName, company }
}

/** The next step that fits what they told us. */
function nextStep(f: ThanksFacts): string {
  if (f.preApproved === false) return "If it would help, I can get you pre-approved so you're ready to make an offer. Want to set up a quick call?"
  if (f.preApproved === true) return "Since you're already pre-approved, I'm happy to run the numbers on this home for you or give you a second opinion. Want me to?"
  return 'Happy to answer any questions about financing this home. Want to set up a quick call?'
}

export function thanksText(f: ThanksFacts): string {
  const first = f.firstName.trim() || 'there'
  const me = f.loFirstName ? `this is ${f.loFirstName} with ${f.company}` : `this is ${f.company}`
  return `Hi ${first}, ${me}. Thanks for stopping by the open house at ${f.address}! ${nextStep(f)}`
}

export function thanksEmail(f: ThanksFacts): { subject: string; body: string } {
  const first = f.firstName.trim() || 'there'
  return {
    subject: `Thanks for visiting ${f.address}`,
    body: [
      `Hi ${first},`,
      '',
      `Thanks for stopping by the open house at ${f.address}. It was great to meet you.`,
      '',
      nextStep(f),
      ...(f.withAgent === true ? ['', "I'm glad to work alongside your agent on the financing side."] : []),
      '',
      'Thank you,',
    ].join('\n'),
  }
}

/** One key per sign-in, so the button can be pressed again without doubling drafts. */
export const thanksKey = (submissionId: string) => `openhouse-thanks:${submissionId}`
