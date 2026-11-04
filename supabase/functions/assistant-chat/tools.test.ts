import { describe, expect, it } from 'vitest'
import { buildSystem, checkMessages, READ_TOOLS, TOOLS } from './tools'

const ctx = {
  userName: 'Connor',
  role: 'owner',
  today: '2026-11-03',
  file: null,
  stages: [
    { id: 'lead', label: 'Lead' },
    { id: 'under_contract', label: 'Under Contract' },
  ],
  lenders: [{ name: 'Sample Lender', programs: ['Conventional 30'] }],
}

describe('tools', () => {
  it('phase 1 is read tools only', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['find_borrower', 'get_borrower_summary', 'list_borrowers', 'list_estimates'])
    for (const t of READ_TOOLS) expect(t.input_schema.type).toBe('object')
  })
})

describe('buildSystem', () => {
  it('says who, when, and the lists', () => {
    const s = buildSystem(ctx)
    expect(s).toContain('for Connor (owner)')
    expect(s).toContain('Today is 2026-11-03')
    expect(s).toContain('under_contract: Under Contract')
    expect(s).toContain('Sample Lender (Conventional 30)')
    expect(s).toContain('Never call them "Loan Estimates"')
    expect(s).toContain('you can never send a text or email')
  })
  it('knows the file it is in', () => {
    const s = buildSystem({ ...ctx, file: { loanId: 'L1', borrowerName: 'Rita TEST', summary: 'Stage: Lead' } })
    expect(s).toContain("working in Rita TEST's file (loan id L1)")
    expect(s).toContain('<current_file>\nStage: Lead\n</current_file>')
  })
})

describe('checkMessages', () => {
  it('takes a normal turn with a tool round trip', () => {
    const r = checkMessages([
      { role: 'user', content: "What's Rita's status?" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'find_borrower', input: { query: 'Rita' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] },
    ])
    expect('messages' in r && r.messages.length).toBe(3)
  })
  it('refuses tools that are not on the list', () => {
    expect(checkMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'send_sms', input: {} }] }])).toEqual({ error: "A tool call that isn't allowed." })
  })
  it('refuses odd shapes', () => {
    expect(checkMessages([])).toEqual({ error: 'No message to answer.' })
    expect(checkMessages([{ role: 'assistant', content: 'hi' }])).toEqual({ error: 'A chat starts with the person.' })
    expect(checkMessages([{ role: 'system', content: 'x' }])).toEqual({ error: 'A message had no role.' })
    expect(checkMessages([{ role: 'user', content: [{ type: 'image' }] }])).toEqual({ error: 'A message had an unknown part.' })
    expect(checkMessages(Array.from({ length: 81 }, () => ({ role: 'user', content: 'x' })))).toEqual({ error: 'This chat is too long to send at once. Start a new chat.' })
  })
})
