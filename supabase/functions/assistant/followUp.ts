// The assistant's "draft a follow-up" task: the prompt, the output schema,
// and the checks every draft must pass before it reaches the Action Queue.
// Pure functions with no imports, so the Edge Function (Deno) and the app's
// tests (Vitest) share exactly the same rules.

export type Channel = 'text' | 'email'
export type Confidence = 'high' | 'medium' | 'low'

/** The facts about one file that the assistant is given. No SSNs or account numbers. */
export interface FileFacts {
  today: string
  borrowerFirstName: string
  borrowerName: string
  coBorrowerNames: string[]
  stage: string
  purpose: string
  mortgageType: string | null
  purchasePrice: number | null
  loanAmount: number | null
  cashOutAmount: number | null
  contractDate: string | null
  optionEndDate: string | null
  closingDate: string | null
  propertyAddress: string | null
  openTasks: { title: string; dueOn: string | null }[]
}

export interface NoteFact {
  id: string
  kind: string
  body: string
  createdAt: string
}

export interface TemplateFact {
  name: string
  channel: Channel
  subject: string | null
  body: string
}

/** Who signs emails. Company NMLS is required on every email. */
export interface Signer {
  loName: string | null
  loNmls: string | null
  loPhone: string | null
  companyName: string
  companyNmls: string
}

export interface FollowUpRequest {
  task: 'follow_up'
  loanId: string
  channel: Channel
  templateId: string | null
  instructions: string | null
}

export interface Draft {
  subject: string | null
  body: string
  confidence: Confidence
  sources: { label: string; quote: string }[]
}

/** Texts longer than two SMS segments read like ads; keep them short. */
export const MAX_TEXT_LENGTH = 320
export const MAX_INSTRUCTIONS_LENGTH = 500
export const COMPANY_NMLS = '2501110'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Checks what the app sent. Returns the request, or a plain-English error. */
export function parseRequest(body: unknown): FollowUpRequest | { error: string } {
  if (!isObject(body) || body.task !== 'follow_up') return { error: 'Unknown assistant task.' }
  if (typeof body.loanId !== 'string' || !UUID.test(body.loanId)) return { error: 'Missing or invalid loan.' }
  if (body.channel !== 'text' && body.channel !== 'email') return { error: 'Pick text or email.' }
  const templateId = body.templateId ?? null
  if (templateId !== null && (typeof templateId !== 'string' || !UUID.test(templateId))) return { error: 'Invalid template.' }
  const instructions = typeof body.instructions === 'string' && body.instructions.trim() ? body.instructions.trim() : null
  if (instructions && instructions.length > MAX_INSTRUCTIONS_LENGTH) return { error: `Keep "what it's about" under ${MAX_INSTRUCTIONS_LENGTH} characters.` }
  return { task: 'follow_up', loanId: body.loanId, channel: body.channel, templateId, instructions }
}

/** The JSON shape Claude must return (enforced by structured outputs, then checked again here). */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Email subject line. Empty string for texts.' },
    body: { type: 'string', description: 'The message itself, without a signature.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are the message fits where this file stands.' },
    sources: {
      type: 'array',
      description: 'Notes the message relies on, each with an exact quote copied from the note.',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, quote: { type: 'string' } },
        required: ['label', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['subject', 'body', 'confidence', 'sources'],
  additionalProperties: false,
} as const

/** Fills {{merge_fields}} in a saved template. Unknown fields are left for the checks to catch. */
export function fillTemplate(text: string, facts: FileFacts, signer: Signer): string {
  const values: Record<string, string> = {
    first_name: facts.borrowerFirstName,
    full_name: facts.borrowerName,
    lo_name: signer.loName ?? '',
    lo_phone: signer.loPhone ?? '',
    company: signer.companyName,
    property_address: facts.propertyAddress ?? '',
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in values && values[key] ? values[key] : m))
}

export const MERGE_FIELDS = ['first_name', 'full_name', 'lo_name', 'lo_phone', 'company', 'property_address'] as const

const words = (v: string) => v.replace(/_/g, ' ')
const money = (n: number | null) => (n === null ? null : `$${Math.round(n).toLocaleString('en-US')}`)

/** The instructions that never change between runs (Connor's voice and the compliance rules). */
export const SYSTEM_PROMPT = `You draft follow-up messages for Connor, a licensed loan officer at MPS Mortgage LLC in Dallas-Fort Worth, Texas. Connor reviews every draft before anything is sent; you never send anything.

Write in Connor's voice: warm, plain, direct, first person, like a text from a real person. Use the borrower's first name. One clear next step or question. No emojis, no hashtags, no exclamation-mark pileups, no sales language.

Compliance rules (these matter more than style):
- Never mention or promise an interest rate, APR, payment amount, percentage or points.
- Never say or imply anything is guaranteed, locked, approved or certain unless the file facts show it.
- Never say "lowest rate", "best rate", "no closing costs" or similar claims.
- Never invent facts. Use only the file facts and notes given. If the notes are thin, keep the message general and set confidence to low.
- Do not include a signature, phone number or NMLS number; the app adds the signature.

Texts: at most ${MAX_TEXT_LENGTH} characters, ideally under 200. Subject is an empty string.
Emails: a short subject (under 60 characters) and two to four short paragraphs.

Sources: for each note the message relies on, give a label (the note's date and kind) and a quote copied word for word from that note. If the message relies on no note, return an empty list.`

/** The per-run message: file facts, recent notes, the template and Connor's ask. */
export function buildUserPrompt(channel: Channel, facts: FileFacts, notes: NoteFact[], template: TemplateFact | null, instructions: string | null, signer: Signer): string {
  const lines = [
    `Draft a follow-up ${channel === 'text' ? 'text message' : 'email'} to ${facts.borrowerFirstName}.`,
    '',
    '<file_facts>',
    `Today: ${facts.today}`,
    `Borrower: ${facts.borrowerName}${facts.coBorrowerNames.length ? ` (co-borrowers: ${facts.coBorrowerNames.join(', ')})` : ''}`,
    `Stage: ${words(facts.stage)}`,
    `Purpose: ${words(facts.purpose)}${facts.mortgageType ? `, ${words(facts.mortgageType)}` : ''}`,
  ]
  const optional: [string, string | null][] = [
    ['Purchase price', money(facts.purchasePrice)],
    ['Loan amount', money(facts.loanAmount)],
    ['Cash out', money(facts.cashOutAmount)],
    ['Property', facts.propertyAddress],
    ['Contract date', facts.contractDate],
    ['Option period ends', facts.optionEndDate],
    ['Closing date', facts.closingDate],
  ]
  for (const [label, value] of optional) if (value) lines.push(`${label}: ${value}`)
  if (facts.openTasks.length) lines.push(`Open tasks: ${facts.openTasks.map((t) => `${t.title}${t.dueOn ? ` (due ${t.dueOn})` : ''}`).join('; ')}`)
  lines.push('</file_facts>', '')
  if (notes.length) {
    lines.push('<recent_notes>')
    for (const n of notes) lines.push(`<note date="${n.createdAt.slice(0, 10)}" kind="${n.kind}">${n.body}</note>`)
    lines.push('</recent_notes>', '')
  } else {
    lines.push('There are no notes on this file yet.', '')
  }
  if (template) {
    lines.push(`Start from Connor's saved template "${template.name}" and personalize it:`, '<template>')
    if (template.subject) lines.push(`Subject: ${fillTemplate(template.subject, facts, signer)}`)
    lines.push(fillTemplate(template.body, facts, signer), '</template>', '')
  }
  if (instructions) lines.push(`What Connor wants this message to be about: ${instructions}`)
  return lines.join('\n').trim()
}

const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Checks Claude's output. Sources whose quote isn't really in one of the
 * notes are dropped (and confidence lowered), so every quote shown is real.
 */
export function validateDraft(raw: unknown, channel: Channel, notes: NoteFact[]): { draft: Draft } | { error: string } {
  if (!isObject(raw)) return { error: 'The assistant returned something unreadable.' }
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  if (!body) return { error: 'The assistant returned an empty message.' }
  const subject = channel === 'email' && typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : null
  if (channel === 'email' && !subject) return { error: 'The email draft has no subject.' }
  let confidence: Confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low' ? raw.confidence : 'low'
  const noteText = notes.map((n) => normalize(n.body))
  const given = Array.isArray(raw.sources) ? raw.sources.filter(isObject) : []
  const sources = given.flatMap((s) => {
    const quote = typeof s.quote === 'string' ? s.quote.trim() : ''
    if (!quote || !noteText.some((t) => t.includes(normalize(quote)))) return []
    return [{ label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : 'Note', quote }]
  })
  if (sources.length < given.length && confidence === 'high') confidence = 'medium'
  return { draft: { subject, body, confidence, sources } }
}

const RULES: [RegExp, string][] = [
  [/guarantee/i, 'says "guarantee"'],
  [/\b(lowest|best|great|low)\s+rates?\b/i, 'makes a rate claim'],
  [/\d\s*(%|percent)/i, 'mentions a percentage'],
  [/\bAPR\b/, 'mentions APR'],
  [/\binterest rate (is|of|at)\b|\brates? (is|are|at) \d/i, 'mentions a specific rate'],
  [/\bno closing costs?\b/i, 'promises no closing costs'],
  [/\bpoints?\b.*\d|\d.*\bpoints?\b/i, 'mentions points'],
  [/\$\s?\d[\d,]*(\.\d+)?\s*(\/|per|a)\s*(mo|month)/i, 'quotes a monthly payment'],
  [/NMLS/i, 'includes an NMLS line (the app adds the signature)'],
  [/\{\{\s*\w+\s*\}\}/, 'has an unfilled merge field'],
]

/** Problems that keep a draft out of the queue. Empty means it passes. */
export function complianceIssues(channel: Channel, draft: Pick<Draft, 'subject' | 'body'>): string[] {
  const text = `${draft.subject ?? ''}\n${draft.body}`
  const issues = RULES.filter(([re]) => re.test(text)).map(([, why]) => `The message ${why}.`)
  if (channel === 'text' && draft.body.length > MAX_TEXT_LENGTH) issues.push(`The text is ${draft.body.length} characters; keep it under ${MAX_TEXT_LENGTH}.`)
  return issues
}

/** The email signature, added by the app so the NMLS lines are always right. */
export function emailSignature(signer: Signer): string {
  const lines = [
    signer.loName ? `${signer.loName}${signer.loNmls ? `, NMLS #${signer.loNmls}` : ''}` : null,
    'Loan Officer',
    `${signer.companyName}, NMLS #${signer.companyNmls}`,
    signer.loPhone,
  ]
  return lines.filter(Boolean).join('\n')
}

/** What lands in the queue: emails get the signature; texts stay as written. */
export function finalBody(channel: Channel, body: string, signer: Signer): string {
  return channel === 'email' ? `${body}\n\n${emailSignature(signer)}` : body
}
