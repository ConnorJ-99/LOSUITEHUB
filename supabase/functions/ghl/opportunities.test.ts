import { describe, expect, it } from 'vitest'
import { chooseOpportunity, newContactBody, pickOpportunities, pickPipelines, planMove, stageLabel, suggestClosed, type GhlOpportunity } from './opportunities'

// The shape GHL answers GET /opportunities/pipelines with (sample ids).
const pipelinesBody = {
  pipelines: [
    { id: 'p-active', name: 'Active Leads', stages: [{ id: 's-new', name: 'New Lead' }, { id: 's-app', name: 'Application' }] },
    { id: 'p-closed', name: ' closed ', stages: [{ id: 's-funded', name: 'Funded' }, { id: 's-recent', name: 'Recently Closed' }] },
    { name: 'No id' },
  ],
}

describe('pipelines', () => {
  const pipelines = pickPipelines(pipelinesBody)
  it('keeps pipelines with an id and their stages in order', () => {
    expect(pipelines.map((p) => p.id)).toEqual(['p-active', 'p-closed'])
    expect(pipelines[1].stages.map((s) => s.name)).toEqual(['Funded', 'Recently Closed'])
  })
  it('finds Closed / Recently Closed by name, ignoring case and spaces', () => {
    expect(suggestClosed(pipelines)).toEqual({ pipelineId: 'p-closed', stageId: 's-recent' })
  })
  it('suggests nothing when the stage is missing', () => {
    expect(suggestClosed([{ id: 'p', name: 'Closed', stages: [{ id: 's', name: 'Funded' }] }])).toBeNull()
  })
  it('labels a saved pair, or says it is gone', () => {
    expect(stageLabel(pipelines, 'p-active', 's-app')).toBe('Active Leads · Application')
    expect(stageLabel(pipelines, 'p-active', 's-recent')).toBeNull()
  })
  it('reads a broken answer as no pipelines', () => {
    expect(pickPipelines(null)).toEqual([])
    expect(pickPipelines({ pipelines: 'x' })).toEqual([])
  })
})

const opp = (id: string, updatedAt: string, extra: Partial<GhlOpportunity> = {}): GhlOpportunity => ({
  id,
  name: 'Pat TEST',
  pipelineId: 'p-active',
  stageId: 's-app',
  status: 'open',
  assignedTo: null,
  updatedAt,
  ...extra,
})

describe('which opportunity is theirs', () => {
  it('reads the search answer', () => {
    const found = pickOpportunities({ opportunities: [{ id: 'o1', pipelineId: 'p', pipelineStageId: 's', status: 'won', assignedTo: 'u1' }, { name: 'no id' }] })
    expect(found).toEqual([{ id: 'o1', name: null, pipelineId: 'p', stageId: 's', status: 'won', assignedTo: 'u1', updatedAt: null }])
  })
  it('none = none', () => expect(chooseOpportunity([], null)).toBeNull())
  it('prefers the one LOSuite saved', () => {
    const r = chooseOpportunity([opp('o1', '2026-10-01'), opp('o2', '2026-10-30')], 'o1')
    expect(r?.opportunity.id).toBe('o1')
    expect(r?.others).toBe(1)
  })
  it('else the most recently updated', () => {
    expect(chooseOpportunity([opp('o1', '2026-10-01'), opp('o2', '2026-10-30')], 'gone')?.opportunity.id).toBe('o2')
  })
})

const base = { target: { pipelineId: 'p-closed', stageId: 's-recent' }, locationId: 'loc', ghlContactId: 'c1', personName: 'Pat TEST', amount: 312000.4, assignedTo: 'u-lo' }

describe('moving the one opportunity', () => {
  it('closing moves the existing one and keeps its status', () => {
    const plan = planMove({ ...base, move: 'closed', existing: opp('o1', '2026-10-01', { status: 'won', assignedTo: 'u-other' }) })
    expect(plan).toEqual({ method: 'PUT', path: '/opportunities/o1', body: { pipelineId: 'p-closed', pipelineStageId: 's-recent' } })
  })
  it('gives an unassigned opportunity to the loan officer', () => {
    expect(planMove({ ...base, move: 'closed', existing: opp('o1', 'x') }).body.assignedTo).toBe('u-lo')
  })
  it('coming back reopens the same one in the active pipeline', () => {
    const plan = planMove({ ...base, move: 'comeback', target: { pipelineId: 'p-active', stageId: 's-new' }, existing: opp('o1', 'x', { status: 'won', assignedTo: 'u-lo' }) })
    expect(plan).toEqual({ method: 'PUT', path: '/opportunities/o1', body: { pipelineId: 'p-active', pipelineStageId: 's-new', status: 'open' } })
  })
  it('makes one only when they have none', () => {
    expect(planMove({ ...base, move: 'closed', existing: null })).toEqual({
      method: 'POST',
      path: '/opportunities/',
      body: { locationId: 'loc', contactId: 'c1', pipelineId: 'p-closed', pipelineStageId: 's-recent', name: 'Pat TEST', status: 'open', monetaryValue: 312000, assignedTo: 'u-lo' },
    })
  })
  it('leaves out an unknown amount and loan officer', () => {
    const body = planMove({ ...base, move: 'closed', existing: null, amount: null, assignedTo: null }).body
    expect(body).not.toHaveProperty('monetaryValue')
    expect(body).not.toHaveProperty('assignedTo')
  })
})

describe('a new GHL contact', () => {
  it('has the person, the loan officer and no tags', () => {
    const body = newContactBody({ locationId: 'loc', firstName: ' Pat ', lastName: 'TEST', email: ' Pat@Example.com ', phoneE164: '+12145550111', assignedTo: 'u-lo' })
    expect(body).toEqual({ locationId: 'loc', firstName: 'Pat', lastName: 'TEST', email: 'pat@example.com', phone: '+12145550111', assignedTo: 'u-lo', source: 'LOSuite' })
    expect(body).not.toHaveProperty('tags')
  })
  it('leaves out blanks', () => {
    expect(newContactBody({ locationId: 'loc', firstName: 'Pat', lastName: null, email: '', phoneE164: null, assignedTo: null })).toEqual({ locationId: 'loc', firstName: 'Pat', source: 'LOSuite' })
  })
})
