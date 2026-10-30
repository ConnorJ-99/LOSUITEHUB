import { describe, expect, it } from 'vitest'
import { channelOf, htmlToText, isStopReply, isTestContact, pickContact, pickConversations, pickEmail, pickMessages, secretMatches, webhookContactId } from './sync'

describe('which GHL messages are kept', () => {
  it('keeps texts and emails, including workflow ones, and nothing else', () => {
    expect(channelOf('TYPE_SMS')).toBe('text')
    expect(channelOf('TYPE_CAMPAIGN_SMS')).toBe('text')
    expect(channelOf('TYPE_EMAIL')).toBe('email')
    expect(channelOf('TYPE_CALL')).toBeNull()
    expect(channelOf('TYPE_ACTIVITY_OPPORTUNITY')).toBeNull()
    expect(channelOf(3)).toBeNull()
  })

  it('reads a conversation\'s messages, flat or nested', () => {
    const msgs = [
      { id: 'm1', messageType: 'TYPE_SMS', direction: 'inbound', body: 'We put in an offer!', dateAdded: '2026-10-29T13:51:00.000Z', conversationId: 'c1', contactId: 'g1', status: 'delivered' },
      { id: 'm2', messageType: 'TYPE_CALL', direction: 'inbound', dateAdded: '2026-10-29T13:52:00.000Z' },
      { id: 'm3', messageType: 'TYPE_EMAIL', direction: 'outbound', body: '<p>Hi&nbsp;Jordan,</p><p>Attached.</p>', meta: { email: { messageIds: ['e1'] } }, dateAdded: '2026-10-29T15:05:00.000Z', userId: 'u1' },
    ]
    const flat = pickMessages({ messages: msgs })
    expect(flat).toHaveLength(2)
    expect(flat[0]).toEqual({ id: 'm1', conversationId: 'c1', contactId: 'g1', channel: 'text', direction: 'inbound', body: 'We put in an offer!', status: 'delivered', sentAt: '2026-10-29T13:51:00.000Z', userId: null, emailId: null })
    expect(flat[1]).toMatchObject({ channel: 'email', direction: 'outbound', body: 'Hi Jordan,\nAttached.', emailId: 'e1', userId: 'u1' })
    expect(pickMessages({ messages: { lastMessageId: 'm3', nextPage: false, messages: msgs } })).toHaveLength(2)
    expect(pickMessages(null)).toEqual([])
  })

  it('reads a full email as plain text', () => {
    expect(pickEmail({ emailMessage: { subject: 'Your pre-approval letter', body: '<div>Hi Jordan<br>See attached.</div><style>p{}</style>', from: 'Connor <connor@example.test>', to: ['jordan@example.test'] } })).toEqual({
      subject: 'Your pre-approval letter',
      body: 'Hi Jordan\nSee attached.',
      from: 'Connor <connor@example.test>',
      to: 'jordan@example.test',
    })
  })

  it('turns HTML into text without running anything in it', () => {
    expect(htmlToText('<script>alert(1)</script><b>Rate</b> &amp; payment&#39;s &lt;here&gt;')).toBe("Rate & payment's <here>")
    expect(htmlToText(null)).toBe('')
  })
})

describe('GHL contacts', () => {
  it('keeps only what matching and opt-outs need (never the SSN)', () => {
    const c = pickContact({ contact: { id: 'g1', firstName: 'Gina', lastName: 'TEST', email: 'gina@example.test', phone: '+12145550111', ssn: '123-45-6789', dndSettings: { SMS: { status: 'active' } } } })
    expect(c).toEqual({ id: 'g1', firstName: 'Gina', lastName: 'TEST', name: null, email: 'gina@example.test', phone: '+12145550111', dndText: true, dndEmail: false })
    expect(JSON.stringify(c)).not.toContain('123-45')
  })

  it('reads Do Not Disturb for all channels', () => {
    expect(pickContact({ contact: { id: 'g2', dnd: true } })).toMatchObject({ dndText: true, dndEmail: true })
    expect(pickContact({ contact: { id: 'g3', dndSettings: { Email: { status: 'permanent' }, SMS: { status: 'inactive' } } } })).toMatchObject({ dndText: false, dndEmail: true })
    expect(pickContact({ contact: {} })).toBeNull()
  })

  it('test mode keeps only contacts named TEST', () => {
    expect(isTestContact({ firstName: 'Gina', lastName: 'TEST', name: null })).toBe(true)
    expect(isTestContact({ firstName: null, lastName: null, name: 'Connor TEST' })).toBe(true)
    expect(isTestContact({ firstName: 'Testa', lastName: 'Rossi', name: null })).toBe(false)
    expect(isTestContact({ firstName: 'Jane', lastName: 'Contest', name: null })).toBe(false)
    expect(isTestContact({ firstName: 'Jane', lastName: 'test', name: null })).toBe(false)
  })
})

describe('opt-outs and webhooks', () => {
  it('a STOP reply is the whole message, any case or punctuation', () => {
    for (const s of ['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'StopAll', 'quit!']) expect(isStopReply(s)).toBe(true)
    for (const s of ['please stop texting at night', "don't stop", 'stopping by', '', null]) expect(isStopReply(s)).toBe(false)
  })

  it('finds the contact in a GHL workflow webhook', () => {
    expect(webhookContactId({ contact_id: 'g1', first_name: 'Gina' })).toBe('g1')
    expect(webhookContactId({ contact: { id: 'g2' } })).toBe('g2')
    expect(webhookContactId({ customData: { contactId: 'g3' } })).toBe('g3')
    expect(webhookContactId({})).toBeNull()
  })

  it('checks the webhook key without timing leaks, and refuses short keys', () => {
    const key = 'a-long-shared-secret-123'
    expect(secretMatches(key, key)).toBe(true)
    expect(secretMatches('a-long-shared-secret-124', key)).toBe(false)
    expect(secretMatches(null, key)).toBe(false)
    expect(secretMatches('short', 'short')).toBe(false)
  })

  it('reads conversations from a search', () => {
    expect(pickConversations({ conversations: [{ id: 'c1', contactId: 'g1', fullName: 'Gina TEST', lastMessageDate: 1761746000000 }, { id: 'c2' }] })).toEqual([{ id: 'c1', contactId: 'g1', name: 'Gina TEST', lastMessageAt: 1761746000000 }])
  })
})
