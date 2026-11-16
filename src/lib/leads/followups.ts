// Suggested lead follow-ups (Connor, 2026-11-16; plan
// docs/plans/lead-follow-ups.md, step 3). The database drafts them
// (draft_lead_followup in 20270203000000_lead_followups.sql, every 30
// minutes); this file reads what a draft carries and fills in its link. Pure,
// tested.
import { portalUrl } from '@/lib/portal/messages'
import type { NextActionId } from './nextAction'

export type LeadFollowupKind = NextActionId | 'new_lead'

/** What a lead follow-up draft knows about the file (payload.lead). */
export interface LeadContext {
  nextAction: LeadFollowupKind
  stage: string
  timeline: string | null
  readyOn: string | null
  lastContactAt: string | null
  /** Why it was suggested, e.g. "Waiting on Documents: 3 days since you last reached them". */
  reason: string
}

const KINDS: readonly LeadFollowupKind[] = ['new_lead', 'waiting_application', 'application_in_progress', 'waiting_documents', 'needs_lo_review', 'ready_to_shop', 'property_found', 'waiting_borrower']
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** The lead context on a queue item's payload; null for other items. */
export function readLeadContext(payload: unknown): LeadContext | null {
  if (!isObject(payload) || !isObject(payload.lead)) return null
  const l = payload.lead
  const kind = KINDS.find((k) => k === l.nextAction)
  if (!kind) return null
  return { nextAction: kind, stage: str(l.stage) ?? '', timeline: str(l.timeline), readyOn: str(l.readyOn), lastContactAt: str(l.lastContactAt), reason: str(l.reason) ?? '' }
}

/** The borrower's portal link token the draft points to ("{link}" in its words). */
export function readLinkToken(payload: unknown): string | null {
  if (!isObject(payload)) return null
  const t = str(payload.linkToken)
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null
}

/** Puts the portal address where the draft says {link}. */
export function fillLink(body: string, token: string | null, origin: string): string {
  if (!body.includes('{link}')) return body
  return token ? body.split('{link}').join(portalUrl(origin, token)) : body
}

/** A draft that still has "{link}" can't go out (its link is missing). */
export const missingLink = (body: string) => body.includes('{link}')

/** Hidden from Today until that day. */
export const isSnoozed = (snoozedUntil: string | null | undefined, today: string) => !!snoozedUntil && snoozedUntil > today

export const KIND_LABEL: Record<LeadFollowupKind, string> = {
  new_lead: 'New lead',
  waiting_application: 'Waiting on Application',
  application_in_progress: 'Application In Progress',
  waiting_documents: 'Waiting on Documents',
  needs_lo_review: 'Needs LO Review',
  ready_to_shop: 'Ready to Shop',
  property_found: 'Property Found',
  waiting_borrower: 'Waiting on Borrower',
}

/** The intervals in Settings (days), with Connor's spec defaults. */
export interface LeadFollowupSettings {
  enabled: boolean
  newLeadDays: number
  waitingApplicationDays: number
  applicationInProgressDays: number
  waitingDocumentsDays: number
  needsLoReviewDays: number
  readyToShopDays: number
  readyToShopSoonDays: number
  propertyFoundDays: number
  waitingBorrowerDays: number
}

export const DEFAULT_LEAD_FOLLOWUP_SETTINGS: LeadFollowupSettings = {
  enabled: false,
  newLeadDays: 0,
  waitingApplicationDays: 2,
  applicationInProgressDays: 1,
  waitingDocumentsDays: 2,
  needsLoReviewDays: 0,
  readyToShopDays: 14,
  readyToShopSoonDays: 7,
  propertyFoundDays: 1,
  waitingBorrowerDays: 3,
}

/** Settings columns ↔ form fields. */
export const SETTING_COLUMNS: Record<Exclude<keyof LeadFollowupSettings, 'enabled'>, string> = {
  newLeadDays: 'new_lead_days',
  waitingApplicationDays: 'waiting_application_days',
  applicationInProgressDays: 'application_in_progress_days',
  waitingDocumentsDays: 'waiting_documents_days',
  needsLoReviewDays: 'needs_lo_review_days',
  readyToShopDays: 'ready_to_shop_days',
  readyToShopSoonDays: 'ready_to_shop_soon_days',
  propertyFoundDays: 'property_found_days',
  waitingBorrowerDays: 'waiting_borrower_days',
}
