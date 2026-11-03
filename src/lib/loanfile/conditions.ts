// Underwriting conditions on a file (tracking only): splitting a pasted list
// into conditions, guessing who each one is on, and the counts the card and
// the Workflow use. Pure.

export const CONDITION_PARTIES = [
  { value: 'borrower', label: 'Borrower' },
  { value: 'title', label: 'Title' },
  { value: 'realtor', label: 'Realtor' },
  { value: 'processor_lo', label: 'Processor / LO' },
  { value: 'appraisal', label: 'Appraisal' },
] as const
export type ConditionParty = (typeof CONDITION_PARTIES)[number]['value']

export const CONDITION_STATUSES = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'requested', label: 'Requested' },
  { value: 'received', label: 'Received' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'waived', label: 'Waived' },
] as const
export type ConditionStatus = (typeof CONDITION_STATUSES)[number]['value']

export interface Condition {
  id: string
  position: number
  body: string
  party: ConditionParty
  status: ConditionStatus
  dueOn: string | null
  notes: string | null
  statusChangedAt: string
}

/** Off our plate: sent to the lender, cleared, or waived. */
export const isHandedIn = (s: ConditionStatus) => s === 'submitted' || s === 'cleared' || s === 'waived'
/** Nothing more needed: cleared or waived. */
export const isCleared = (s: ConditionStatus) => s === 'cleared' || s === 'waived'

/** "4 of 9 cleared", and whether every condition is handed in (the Workflow's "Submit conditions"). */
export function conditionCounts(statuses: ConditionStatus[]): { total: number; cleared: number; allHandedIn: boolean } {
  return { total: statuses.length, cleared: statuses.filter(isCleared).length, allHandedIn: statuses.length > 0 && statuses.every(isHandedIn) }
}

const PARTY_WORDS: [RegExp, ConditionParty][] = [
  [/\b(apprais(al|er|ed)|1004|value|comparable|comps?|inspection|442|completion cert)/i, 'appraisal'],
  [/\b(title|escrow|closing protection|cpl|wire instructions|survey|vesting|deed|payoff|tax cert)/i, 'title'],
  [/\b(realtor|agent|listing|amend(ed|ment)? (to )?(the )?contract|contract amendment|addend|earnest money receipt|seller)/i, 'realtor'],
  [/\b(processor|lender to|underwriter to|internal|disclos|change of circumstance|coc|rate lock|lock confirmation|aus|du\b|lp\b|1003 signed|ld\b|le\b|cd\b|voe|verbal verification)/i, 'processor_lo'],
]

/** Who a condition is most likely on, from its words; the borrower when nothing else fits. */
export function guessParty(text: string): ConditionParty {
  for (const [re, party] of PARTY_WORDS) if (re.test(text)) return party
  return 'borrower'
}

/** A line that starts a new condition: "1.", "2)", "#101", "101 -", "•", "-", "*", or a lender code like "PTD:". */
const START = /^\s*(?:(?:#?\d{1,4}\s*[.):-]+|#\d{1,4}\b)|[•·▪◦●*-]|(?:PT[ADFCL]|PRIOR TO (?:DOCS|FUNDING|CLOSING|APPROVAL))\s*[:-]?)\s*/i

/**
 * Splits a pasted list into conditions. Numbered or bulleted lists start a
 * condition at each number or bullet, and lines that wrap stay with their
 * condition; a plain list (no numbers) is one condition per line. Numbers,
 * bullets and lender codes are taken off, blank lines are skipped, and each
 * condition gets a guess at who it's on.
 */
export function splitConditions(text: string): { body: string; party: ConditionParty }[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\t+/g, ' ').trimEnd())
  const numbered = lines.some((l) => START.test(l) && l.replace(START, '').trim())
  const out: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    if (!numbered || START.test(line) || out.length === 0) out.push(line.replace(START, '').trim())
    else out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`
  }
  return out.filter(Boolean).map((body) => ({ body: body.replace(/\s+/g, ' '), party: guessParty(body) }))
}
