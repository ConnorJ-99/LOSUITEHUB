import { describe, expect, it } from 'vitest'
import { isGone, pushPayload, secretMatches } from './payload'

describe('pushPayload', () => {
  it('carries the title, a short body and the in-app link', () => {
    const p = JSON.parse(pushPayload({ id: 'n1', kind: 'reply', title: 'Rita TEST texted you', body: 'Do you need my W-2s?', link: '/loans/abc?tab=messages' }))
    expect(p).toEqual({ id: 'n1', title: 'Rita TEST texted you', body: 'Do you need my W-2s?', link: '/loans/abc?tab=messages', tag: 'reply:/loans/abc?tab=messages' })
  })
  it('never links outside the app', () => {
    expect(JSON.parse(pushPayload({ id: 'n', kind: 'test', title: 't', body: null, link: 'https://evil.example' })).link).toBe('/')
    expect(JSON.parse(pushPayload({ id: 'n', kind: 'test', title: 't', body: null, link: '//evil.example' })).link).toBe('/')
  })
  it('keeps the lock screen short', () => {
    const p = JSON.parse(pushPayload({ id: 'n', kind: 'reply', title: 'x'.repeat(200), body: 'y'.repeat(500), link: '/' }))
    expect(p.title.length).toBe(80)
    expect(p.body.length).toBe(160)
  })
})

describe('helpers', () => {
  it('drops devices the push service says are gone', () => {
    expect(isGone(410)).toBe(true)
    expect(isGone(404)).toBe(true)
    expect(isGone(429)).toBe(false)
    expect(isGone(undefined)).toBe(false)
  })
  it('checks the key', () => {
    expect(secretMatches('a'.repeat(20), 'a'.repeat(20))).toBe(true)
    expect(secretMatches('b'.repeat(20), 'a'.repeat(20))).toBe(false)
    expect(secretMatches('short', 'short')).toBe(false)
  })
})
