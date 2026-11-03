// GHL contacts and opportunities (next build Session 2, Connor 2026-11-02;
// decisions 2–3 in docs/plans/next-build.md). Pure and import-free so it can
// be tested and pasted with index.ts.
//
// One person = one GHL contact and ONE GHL opportunity, however many loans
// they have in LOSuite. Closing a loan moves that opportunity to the Closed
// pipeline's "Recently Closed" stage (or makes it, if they have none); copying
// a closed client to a new lead moves the SAME opportunity back to the active
// pipeline and stage picked in Settings. A second opportunity is never made.
//
// Endpoints (HighLevel API v2, apps/opportunities.json and apps/contacts.json,
// Version 2021-07-28):
// - GET  /opportunities/pipelines?locationId    opportunities.readonly
// - GET  /opportunities/search?location_id&contact_id   opportunities.readonly
// - POST /opportunities/                         opportunities.write
// - PUT  /opportunities/{id}                     opportunities.write
// - POST /contacts/                              contacts.write

export interface GhlStage {
  id: string
  name: string
}

export interface GhlPipeline {
  id: string
  name: string
  stages: GhlStage[]
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** GHL's pipelines and their stages, in GHL's order. */
export function pickPipelines(body: unknown): GhlPipeline[] {
  const list = (body as { pipelines?: unknown } | null)?.pipelines
  if (!Array.isArray(list)) return []
  return list.flatMap((p: Record<string, unknown>) => {
    const id = str(p.id)
    if (!id) return []
    const stages = Array.isArray(p.stages)
      ? p.stages.flatMap((s: Record<string, unknown>) => (str(s.id) ? [{ id: str(s.id)!, name: str(s.name) ?? 'Unnamed stage' }] : []))
      : []
    return [{ id, name: str(p.name) ?? 'Unnamed pipeline', stages }]
  })
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The "Closed" pipeline's "Recently Closed" stage, found by name (decision 2). Null when either isn't there. */
export function suggestClosed(pipelines: GhlPipeline[]): { pipelineId: string; stageId: string } | null {
  const pipeline = pipelines.find((p) => same(p.name, 'Closed'))
  const stage = pipeline?.stages.find((s) => same(s.name, 'Recently Closed'))
  return pipeline && stage ? { pipelineId: pipeline.id, stageId: stage.id } : null
}

/** "Closed · Recently Closed", or null when the pair isn't in GHL's list (deleted or renamed in GHL). */
export function stageLabel(pipelines: GhlPipeline[], pipelineId: string, stageId: string): string | null {
  const p = pipelines.find((x) => x.id === pipelineId)
  const s = p?.stages.find((x) => x.id === stageId)
  return p && s ? `${p.name} · ${s.name}` : null
}

export interface GhlOpportunity {
  id: string
  name: string | null
  pipelineId: string | null
  stageId: string | null
  status: string | null
  assignedTo: string | null
  updatedAt: string | null
}

export function pickOpportunity(o: Record<string, unknown> | null | undefined): GhlOpportunity | null {
  const id = str(o?.id)
  if (!o || !id) return null
  return {
    id,
    name: str(o.name),
    pipelineId: str(o.pipelineId),
    stageId: str(o.pipelineStageId),
    status: str(o.status),
    assignedTo: str(o.assignedTo),
    updatedAt: str(o.updatedAt),
  }
}

/** The opportunities in a search answer (GET /opportunities/search). */
export function pickOpportunities(body: unknown): GhlOpportunity[] {
  const list = (body as { opportunities?: unknown } | null)?.opportunities
  return Array.isArray(list) ? list.flatMap((o) => pickOpportunity(o as Record<string, unknown>) ?? []) : []
}

/**
 * Which of the contact's opportunities is "theirs": the one LOSuite saved,
 * else their only one, else the most recently updated (and say there were
 * several, so someone can tidy GHL). Null = they have none.
 */
export function chooseOpportunity(found: GhlOpportunity[], storedId: string | null): { opportunity: GhlOpportunity; others: number } | null {
  if (!found.length) return null
  const stored = storedId ? found.find((o) => o.id === storedId) : undefined
  const pick = stored ?? [...found].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
  return { opportunity: pick, others: found.length - 1 }
}

export type OpportunityMove = 'closed' | 'comeback'

export interface MovePlan {
  method: 'POST' | 'PUT'
  path: string
  body: Record<string, unknown>
}

/**
 * The one GHL call that puts the person's opportunity where it belongs.
 * Closing keeps the opportunity's status as it is; coming back reopens it.
 * A new opportunity (only when they have none) is named after the person and
 * assigned to the loan officer. An existing one gets the loan officer only
 * when nobody is assigned, so a GHL assignment is never taken away.
 */
export function planMove(v: {
  move: OpportunityMove
  existing: GhlOpportunity | null
  target: { pipelineId: string; stageId: string }
  locationId: string
  ghlContactId: string
  personName: string
  amount: number | null
  assignedTo: string | null
}): MovePlan {
  if (v.existing) {
    return {
      method: 'PUT',
      path: `/opportunities/${encodeURIComponent(v.existing.id)}`,
      body: {
        pipelineId: v.target.pipelineId,
        pipelineStageId: v.target.stageId,
        ...(v.move === 'comeback' ? { status: 'open' } : {}),
        ...(!v.existing.assignedTo && v.assignedTo ? { assignedTo: v.assignedTo } : {}),
      },
    }
  }
  return {
    method: 'POST',
    path: '/opportunities/',
    body: {
      locationId: v.locationId,
      contactId: v.ghlContactId,
      pipelineId: v.target.pipelineId,
      pipelineStageId: v.target.stageId,
      name: v.personName,
      status: 'open',
      ...(v.amount && v.amount > 0 ? { monetaryValue: Math.round(v.amount) } : {}),
      ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}),
    },
  }
}

/**
 * A new GHL contact (POST /contacts/), only after LOSuite's own match and
 * GHL's duplicate search both found no one. Assigned to the loan officer's
 * GHL user. No tags: tags start Connor's GHL workflows. Never an SSN.
 */
export function newContactBody(v: {
  locationId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phoneE164: string | null
  assignedTo: string | null
}): Record<string, unknown> {
  const email = v.email?.trim().toLowerCase() || null
  return {
    locationId: v.locationId,
    ...(v.firstName?.trim() ? { firstName: v.firstName.trim() } : {}),
    ...(v.lastName?.trim() ? { lastName: v.lastName.trim() } : {}),
    ...(email ? { email } : {}),
    ...(v.phoneE164 ? { phone: v.phoneE164 } : {}),
    ...(v.assignedTo ? { assignedTo: v.assignedTo } : {}),
    source: 'LOSuite',
  }
}
