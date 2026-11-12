import { describe, expect, it } from 'vitest'
import { onHoldLeads } from './hold'

const file = (id: string, stage: string, onHoldAt: string | null) => ({ id, stage, onHoldAt, stageChangedAt: '2026-11-01T00:00:00Z' })

describe('onHoldLeads', () => {
  it('lists open files on hold, longest on hold first', () => {
    const files = [file('a', 'pre_approved', '2026-11-10T00:00:00Z'), file('b', 'under_contract', '2026-10-01T00:00:00Z'), file('c', 'lead', null)]
    expect(onHoldLeads(files).map((f) => f.id)).toEqual(['b', 'a'])
  })
  it('leaves out closed and lost files even if they were on hold', () => {
    expect(onHoldLeads([file('a', 'closed', '2026-11-01T00:00:00Z'), file('b', 'lost', '2026-11-01T00:00:00Z')])).toEqual([])
  })
})
