// The assistant's "read a pasted product-update email" task (Phase 0b): the
// JSON shape, its instructions, and the checks on what comes back. Shared by
// the Edge Function (Deno) and the app.
//
// The assistant gets the email and the lender's programs with the rules each
// has on file. It names the programs the email is about and lists each change
// with the exact sentence it came from. Code keeps only changes whose quote is
// really in the email (case, spacing and curly quotes aside) and whose
// program is one of the lender's; the rest are listed as left out. The
// assistant never approves anything: Connor ticks the changes, and approving
// the drafts they make is the usual matrix approval.

// The response form stays under the API limit of 16 "value or null" fields (schemas.test.ts): lists are
// plain arrays where empty means none.
// Import-free (the paste builder needs that): the lists below are matrix.ts's, and a test keeps them the same.
export const DOC_TYPES = ['full_doc', 'bank_statement_12', 'bank_statement_24', 'form_1099', 'pnl_only', 'asset_depletion', 'dscr', 'wvoe', 'no_ratio', 'retirement_distribution'] as const
export const PURPOSES = ['purchase', 'rate_term', 'cash_out'] as const
export const PROPERTY_TYPES = ['sfr_pud', 'condo', 'non_warrantable_condo', 'two_to_four', 'manufactured', 'mixed_use', 'condotel', 'rural', 'five_plus'] as const
export const OCCUPANCIES = ['primary', 'second_home', 'investment'] as const
export const RULE_FIELDS = ['dti', 'reserves_months', 'mortgage_lates_12', 'mortgage_lates_24', 'bk_seasoning_months', 'fc_seasoning_months', 'state', 'citizenship', 'self_employed_years', 'loan_amount', 'fico', 'ltv', 'cltv', 'dscr', 'units', 'first_time_buyer', 'income_vs_ami'] as const
export const RULE_OPS = ['<=', '>=', 'in', 'not_in', 'required', 'between'] as const

type Of<T extends readonly string[]> = T[number]

/** matrix.ts's ReadRule, as far as an update needs it. */
interface ReadRule {
  field: Of<typeof RULE_FIELDS>
  op: Of<typeof RULE_OPS>
  value: number | string[] | { min: number; max: number } | null
  appliesWhen: { purposes?: Of<typeof PURPOSES>[]; occupancies?: Of<typeof OCCUPANCIES>[]; ltv_above?: number; loan_amount_below?: number; states?: string[]; property_types?: Of<typeof PROPERTY_TYPES>[] } | null
  severity: 'hard' | 'verify'
  message: string
}

/** A matrix square (or squares) whose limit changes. Null = every value of that dimension in the program. */
export interface LimitTarget {
  occupancy: Of<typeof OCCUPANCIES> | null
  purposes: Of<typeof PURPOSES>[] | null
  propertyTypes: Of<typeof PROPERTY_TYPES>[] | null
  docType: Of<typeof DOC_TYPES> | null
  /** The credit row's minimum score (700 for "700-719" or "700+"); null = every row. */
  ficoMin: number | null
  /** The loan tier's upper amount; null = every tier. */
  loanAmountMax: number | null
  ratio: 'ltv' | 'cltv'
}

export interface UpdateChange {
  /** Stable within one update, for the tick boxes. */
  id: string
  programId: string
  kind: 'rule' | 'limit' | 'text'
  /** "Max DTI raised to 55%". */
  summary: string
  /** The sentence from the email, word for word. */
  quote: string
  /** kind 'rule': set (add, or replace the rule on the same field and conditions) or remove. */
  action?: 'set' | 'remove'
  rule?: Pick<ReadRule, 'field' | 'op' | 'value' | 'appliesWhen' | 'severity' | 'message'>
  /** kind 'limit': the squares, and the new limit (null = no longer offered). */
  target?: LimitTarget
  value?: number | null
}

export interface UpdateProposal {
  /** The programs the email is about. */
  programIds: string[]
  /** The date the changes take effect, YYYY-MM-DD, if the email says. */
  effectiveDate: string | null
  changes: UpdateChange[]
  /** Changes whose quote wasn't found in the email, or that didn't fit; shown so Connor can check by hand. */
  leftOut: string[]
  /** A sentence or two on what the email says, from the assistant. */
  notes: string | null
}

/** What the assistant is told about each of the lender's programs. */
export interface UpdateProgram {
  id: string
  name: string
  family: string
  lien: string
  rules: Pick<ReadRule, 'field' | 'op' | 'value' | 'appliesWhen' | 'message'>[]
}

export const MAX_EMAIL_CHARS = 60000

const nullable = (schema: Record<string, unknown>, description?: string) => ({ anyOf: [schema, { type: 'null' }], ...(description && { description }) })
const enumList = (values: readonly string[]) => ({ type: 'array', items: { type: 'string', enum: [...values] } })

export const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    program_ids: { type: 'array', items: { type: 'string' }, description: 'The ids of the programs the email is about. Empty if none of them.' },
    effective_date: { type: 'string', description: 'When the changes take effect, as YYYY-MM-DD, or empty if the email does not say.' },
    notes: { type: 'string', description: 'One or two plain sentences on what the email announces.' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          program_id: { type: 'string' },
          kind: { type: 'string', enum: ['rule', 'limit', 'text'], description: 'rule = a program-wide limit (max DTI, min FICO, states, reserves, loan amounts, seasoning...); limit = a max LTV/CLTV square in the matrix; text = a guideline change with no number the matrix or rules can hold.' },
          summary: { type: 'string', description: 'Short and plain, e.g. "Max DTI raised to 55%".' },
          quote: { type: 'string', description: 'The exact sentence from the email this change comes from, copied word for word.' },
          rule_action: nullable({ type: 'string', enum: ['set', 'remove'] }, 'For rule: set (new or changed) or remove.'),
          rule_field: nullable({ type: 'string', enum: [...RULE_FIELDS] }),
          rule_op: nullable({ type: 'string', enum: [...RULE_OPS] }),
          rule_number: nullable({ type: 'number' }, 'For <= and >=: the number (55 for 55%, 640 for a 640 score, 6 for 6 months).'),
          rule_list: { type: 'array', items: { type: 'string' }, description: 'For in / not_in: the FULL new list (two-letter state codes for states), the current list with the change applied. Empty otherwise.' },
          rule_min: nullable({ type: 'number' }),
          rule_max: nullable({ type: 'number' }),
          applies_purposes: { ...enumList(PURPOSES), description: 'Only when the email limits the rule to these purposes; empty otherwise.' },
          applies_occupancies: { ...enumList(OCCUPANCIES), description: 'Only when the email limits the rule to these occupancies; empty otherwise.' },
          limit_occupancy: nullable({ type: 'string', enum: [...OCCUPANCIES] }),
          limit_purposes: { ...enumList(PURPOSES), description: 'Empty = every purpose.' },
          limit_property_types: { ...enumList(PROPERTY_TYPES), description: 'Empty = every property type.' },
          limit_doc_type: nullable({ type: 'string', enum: [...DOC_TYPES] }),
          limit_fico_min: nullable({ type: 'integer' }, 'The credit row by its lowest score; null = every row.'),
          limit_loan_amount_max: nullable({ type: 'number' }, 'The loan tier by its upper amount; null = every tier.'),
          limit_ratio: nullable({ type: 'string', enum: ['ltv', 'cltv'] }),
          limit_value: nullable({ type: 'number' }, 'The new max percent, or null when that square is no longer offered.'),
        },
        required: ['program_id', 'kind', 'summary', 'quote', 'rule_action', 'rule_field', 'rule_op', 'rule_number', 'rule_list', 'rule_min', 'rule_max', 'applies_purposes', 'applies_occupancies', 'limit_occupancy', 'limit_purposes', 'limit_property_types', 'limit_doc_type', 'limit_fico_min', 'limit_loan_amount_max', 'limit_ratio', 'limit_value'],
        additionalProperties: false,
      },
    },
  },
  required: ['program_ids', 'effective_date', 'notes', 'changes'],
  additionalProperties: false,
}

export const UPDATE_SYSTEM_PROMPT = `You read an email a mortgage lender sent a broker about changes to its loan programs or guidelines, and list each change so a loan officer can confirm it. You are not a source of guideline facts: use only what the email says.

Rules:
- Pick the programs the email is about from the list given, by id. If it names a program that isn't listed, leave it out and say so in notes.
- One change per thing that changes, for each program it applies to. Every change quotes the exact sentence from the email it comes from, copied character for character. Never paraphrase a quote.
- kind "rule" is for program-wide limits that fit the rule fields (max DTI, minimum FICO, reserves months, states, loan amount min/max, seasoning, units, DSCR). Compare with the program's current rules: use "set" for a new or changed limit, "remove" when the email drops one. For states, give the full new list.
- kind "limit" is for a maximum LTV or CLTV in the matrix grid, described by occupancy, purpose, property type, income type, the credit row's lowest score and the loan tier's upper amount (null where the email means all of them).
- kind "text" is for guideline changes with no number those can hold (documentation, appraisal, eligibility wording). The email is saved as guideline text either way.
- Leave out rate and pricing changes, marketing, webinars and contact details.
- If the email has no program changes, return no changes and say why in notes.`

export function updatePrompt(email: string, subject: string | null, lender: string, programs: UpdateProgram[]): string {
  const list = programs
    .map((p) => `<program id="${p.id}" name="${p.name}" family="${p.family}" lien="${p.lien}">\n${p.rules.length ? p.rules.map((r) => `- ${r.field} ${r.op} ${JSON.stringify(r.value)}${r.appliesWhen ? ` when ${JSON.stringify(r.appliesWhen)}` : ''}: ${r.message}`).join('\n') : '(no program-wide rules on file)'}\n</program>`)
    .join('\n')
  return `<lender>${lender}</lender>\n\n<programs>\n${list}\n</programs>\n\n<email>\n${subject ? `Subject: ${subject}\n\n` : ''}${email}\n</email>`
}

/** Case, spacing, curly quotes and dashes aside. */
export const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

/** True when the quote really is in the email (at least a few words, ending punctuation aside). */
export function quoteFound(quote: string, email: string): boolean {
  const q = squash(quote.replace(/^["“]|["”]$/g, '')).replace(/[.;,:]$/, '')
  return q.length >= 8 && squash(email).includes(q)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const listOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] | null => (Array.isArray(v) ? (v.filter((x) => (allowed as readonly string[]).includes(x as string)) as T[]) : null)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(v as string) ? (v as T) : null)

/** The rule value in ReadRule's shape, or undefined when the op and values don't fit. */
function ruleValue(op: Of<typeof RULE_OPS>, c: Record<string, unknown>): ReadRule['value'] | undefined {
  if (op === '<=' || op === '>=') return numOrNull(c.rule_number) ?? undefined
  if (op === 'in' || op === 'not_in') {
    const l = Array.isArray(c.rule_list) ? c.rule_list.map((x) => str(x).toUpperCase()).filter(Boolean) : []
    return l.length ? [...new Set(l)] : undefined
  }
  if (op === 'between') {
    const min = numOrNull(c.rule_min)
    const max = numOrNull(c.rule_max)
    return min != null && max != null && min <= max ? { min, max } : undefined
  }
  return null
}

/** Checks the assistant's reply: real programs only, every quote found in the email, values that fit. */
export function normalizeProposal(raw: unknown, email: string, programIds: string[]): UpdateProposal | { error: string } {
  if (!isObject(raw) || !Array.isArray(raw.changes)) return { error: 'The assistant returned something unreadable. Try again.' }
  const known = new Set(programIds)
  const leftOut: string[] = []
  const changes: UpdateChange[] = []
  raw.changes.forEach((c, i) => {
    if (!isObject(c)) return
    const summary = str(c.summary) || 'Change'
    const quote = str(c.quote).replace(/^["“]|["”]$/g, '')
    const programId = str(c.program_id)
    const kind = oneOf(c.kind, ['rule', 'limit', 'text'] as const)
    if (!known.has(programId)) return leftOut.push(`${summary} (not one of this lender's programs)`)
    if (!kind) return leftOut.push(`${summary} (couldn't tell what kind of change)`)
    if (!quoteFound(quote, email)) return leftOut.push(`${summary} (its quote isn't in the email word for word)`)
    const base = { id: `c${i + 1}`, programId, kind, summary, quote }
    if (kind === 'text') return changes.push(base)
    if (kind === 'rule') {
      const field = oneOf(c.rule_field, RULE_FIELDS)
      const op = oneOf(c.rule_op, RULE_OPS)
      const action = oneOf(c.rule_action, ['set', 'remove'] as const) ?? 'set'
      const value = op ? ruleValue(op, c) : undefined
      if (!field || !op || (action === 'set' && value === undefined)) return leftOut.push(`${summary} (the rule's values didn't fit)`)
      const purposes = listOf(c.applies_purposes, PURPOSES)
      const occupancies = listOf(c.applies_occupancies, OCCUPANCIES)
      const appliesWhen = purposes?.length || occupancies?.length ? { ...(purposes?.length && { purposes }), ...(occupancies?.length && { occupancies }) } : null
      return changes.push({ ...base, action, rule: { field, op, value: value ?? null, appliesWhen, severity: 'hard', message: summary } })
    }
    const ratio = oneOf(c.limit_ratio, ['ltv', 'cltv'] as const) ?? 'ltv'
    const value = numOrNull(c.limit_value)
    if (value != null && (value <= 0 || value > 150)) return leftOut.push(`${summary} (the new limit isn't a percent)`)
    const purposes = listOf(c.limit_purposes, PURPOSES)
    const propertyTypes = listOf(c.limit_property_types, PROPERTY_TYPES)
    changes.push({
      ...base,
      target: {
        occupancy: oneOf(c.limit_occupancy, OCCUPANCIES),
        purposes: purposes?.length ? purposes : null,
        propertyTypes: propertyTypes?.length ? propertyTypes : null,
        docType: oneOf(c.limit_doc_type, DOC_TYPES),
        ficoMin: numOrNull(c.limit_fico_min),
        loanAmountMax: numOrNull(c.limit_loan_amount_max),
        ratio,
      },
      value,
    })
  })
  const effective = str(raw.effective_date)
  const ids = Array.isArray(raw.program_ids) ? raw.program_ids.map(str).filter((id) => known.has(id)) : []
  return {
    programIds: [...new Set([...ids, ...changes.map((c) => c.programId)])],
    effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(effective) ? effective : null,
    changes,
    leftOut,
    notes: str(raw.notes) || null,
  }
}
