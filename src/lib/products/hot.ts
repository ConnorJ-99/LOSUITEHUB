// Hot programs per qualifying type (Connor, 2026-11-13): on the Lenders page,
// a program is marked Hot for the qualifying types Connor uses that lender
// for: "Newfi Non-QM is Hot for Bank statement", "UWM Conventional is Hot for
// Conventional". Match lenders then shows the programs Hot for the scenario's
// type. Agency programs are Hot by family; Non-QM programs by income
// documentation (12 and 24 months of bank statements are one type). Pure.

import { DOC_TYPES, PRODUCT_FAMILIES, type DocType } from './taxonomy'
import type { CatalogProgram, Scenario } from './types'

/** A qualifying type a program can be Hot for: a family ('conventional', 'fha'…) or a Non-QM documentation type ('bank_statement', 'dscr'…). */
export type HotKey = string

/** 12 and 24 months of bank statements count as one type. */
export const docHotKey = (d: DocType): HotKey => (d === 'bank_statement_12' || d === 'bank_statement_24' ? 'bank_statement' : d)

export function hotKeyLabel(key: HotKey): string {
  if (key === 'bank_statement') return 'Bank statement'
  if ((PRODUCT_FAMILIES.values as readonly string[]).includes(key)) return PRODUCT_FAMILIES.label[key as keyof typeof PRODUCT_FAMILIES.label]
  return (DOC_TYPES.label as Record<string, string>)[key] ?? key
}

/** The types this program can be Hot for. */
export function hotKeysOf(p: Pick<CatalogProgram, 'family' | 'docTypes'>): HotKey[] {
  if (p.family !== 'non_qm') return [p.family]
  return [...new Set(p.docTypes.map(docHotKey))]
}

/** Which of its types the program is being matched as in this scenario. */
export const hotKeyFor = (p: Pick<CatalogProgram, 'family'>, s: Pick<Scenario, 'docType'>): HotKey => (p.family === 'non_qm' ? docHotKey(s.docType) : p.family)

/** Hot for this scenario: the program is marked Hot for the type it's being matched as. */
export const isHotFor = (p: Pick<CatalogProgram, 'family'>, hotFor: readonly HotKey[] | undefined, s: Pick<Scenario, 'docType'>): boolean => !!hotFor?.includes(hotKeyFor(p, s))
