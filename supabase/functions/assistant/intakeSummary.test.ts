import { describe, expect, it } from 'vitest'
import { APPROVAL_WORDS } from '../../../src/lib/intake/review'
import { INTAKE_BANNED, buildIntakePrompt, readIntakeSummary } from './intakeSummary'

describe('intake summary (AI)', () => {
  it('keeps the banned words equal to the app list', () => {
    expect(INTAKE_BANNED.source).toBe(APPROVAL_WORDS.source)
  })

  it('accepts a factual summary', () => {
    expect(readIntakeSummary({ headline: 'Maria · purchase in Frisco ~$385k, offer out', summary_paragraph: 'First-time buyer with an offer out. Student loans are deferred until March.' })).toEqual({
      headline: 'Maria · purchase in Frisco ~$385k, offer out',
      summary_paragraph: 'First-time buyer with an offer out. Student loans are deferred until March.',
    })
  })

  it('refuses approval language and empty text', () => {
    expect(readIntakeSummary({ headline: 'Maria', summary_paragraph: 'She should qualify for FHA.' })).toEqual({ error: 'approval language' })
    expect(readIntakeSummary({ headline: '', summary_paragraph: 'x' })).toEqual({ error: 'missing text' })
    expect(readIntakeSummary(null)).toEqual({ error: 'unreadable' })
  })

  it('puts the facts before the answers', () => {
    const p = buildIntakePrompt({ goal: { goal: 'purchase' } }, { key_numbers: { price: 385000 } })
    expect(p.indexOf('385000')).toBeLessThan(p.indexOf('purchase'))
  })
})
