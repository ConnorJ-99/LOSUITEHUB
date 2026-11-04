import { describe, expect, it } from 'vitest'
import { buildReplyPrompt, latestBurst, needsNoReply, readReply, replyChannel, replySourceKey, replySubject, templateReply, type ThreadMessage } from './replyDraft'

const msg = (id: string, direction: 'inbound' | 'outbound', body: string, minute: number, channel: 'text' | 'email' = 'text', subject: string | null = null): ThreadMessage => ({
  id,
  channel,
  direction,
  subject,
  body,
  sentAt: new Date(Date.UTC(2026, 10, 3, 15, minute)).toISOString(),
})

describe('latestBurst', () => {
  it('is what the client sent since our last message, oldest first', () => {
    const t = [msg('a', 'inbound', 'hi', 1), msg('b', 'outbound', 'hello', 2), msg('c', 'inbound', 'quick question', 3), msg('d', 'inbound', 'about the appraisal', 4)]
    expect(latestBurst(t).map((m) => m.id)).toEqual(['c', 'd'])
  })
  it('is empty when our message is the newest', () => {
    expect(latestBurst([msg('a', 'inbound', 'hi', 1), msg('b', 'outbound', 'hello', 2)])).toEqual([])
  })
  it('sorts by time whatever order the messages come in', () => {
    expect(latestBurst([msg('d', 'inbound', 'two', 4), msg('b', 'outbound', 'x', 2), msg('c', 'inbound', 'one', 3)]).map((m) => m.id)).toEqual(['c', 'd'])
  })
})

describe('needsNoReply', () => {
  const never = () => false
  it('skips bare thanks and okays', () => {
    for (const b of ['Thanks!', 'ok', 'Sounds good.', 'Liked a message', 'thank you']) expect(needsNoReply([msg('a', 'inbound', b, 1)], never)).toBe(true)
  })
  it('answers real questions', () => {
    expect(needsNoReply([msg('a', 'inbound', 'Thanks! When do you need the bank statements?', 1)], never)).toBe(false)
  })
  it('skips opt-outs', () => {
    expect(needsNoReply([msg('a', 'inbound', 'STOP', 1)], (m) => m.body === 'STOP')).toBe(true)
  })
  it('skips an empty burst', () => {
    expect(needsNoReply([], never)).toBe(true)
  })
})

describe('reply shape', () => {
  it('answers on the channel they used last', () => {
    expect(replyChannel([msg('a', 'inbound', 'x', 1, 'text'), msg('b', 'inbound', 'y', 2, 'email', 'Docs')])).toBe('email')
  })
  it('uses Re: their subject, once', () => {
    expect(replySubject([msg('a', 'inbound', 'y', 2, 'email', 'Bank statements')])).toBe('Re: Bank statements')
    expect(replySubject([msg('a', 'inbound', 'y', 2, 'email', 'RE: Bank statements')])).toBe('RE: Bank statements')
    expect(replySubject([msg('a', 'inbound', 'y', 2)])).toBe('Re: Your loan')
  })
  it('has a template start without AI', () => {
    expect(templateReply('Rita', 'text')).toBe('Hi Rita, thanks for your message. ')
    expect(templateReply('', 'email')).toBe('Hi there,\n\nThanks for your message. ')
  })
  it('keys one draft per burst', () => {
    expect(replySourceKey('c1', 'm1')).toBe('reply:c1:m1')
  })
})

describe('the AI prompt and answer', () => {
  it('fences the conversation off and keeps the last 12 messages', () => {
    const thread = Array.from({ length: 15 }, (_, i) => msg(`m${i}`, i % 2 ? 'outbound' : 'inbound', `message ${i}`, i))
    const p = buildReplyPrompt('text', { firstName: 'Rita', stage: 'under_contract', purpose: 'purchase', loName: 'Connor' }, thread)
    expect(p).toContain('<conversation>')
    expect(p).toContain('Stage: under contract')
    expect(p).not.toContain('message 2\n')
    expect(p).toContain('message 14')
    expect(p.match(/\(text\)/g)?.length).toBe(12)
  })
  it('reads a good answer and refuses an empty one', () => {
    expect(readReply({ body: ' Hi Rita ', confidence: 'high' })).toEqual({ body: 'Hi Rita', confidence: 'high' })
    expect(readReply({ body: '', confidence: 'high' })).toEqual({ error: 'empty' })
    expect(readReply({ body: 'x', confidence: 'sure' })).toEqual({ body: 'x', confidence: 'low' })
    expect(readReply(null)).toEqual({ error: 'unreadable' })
  })
})
