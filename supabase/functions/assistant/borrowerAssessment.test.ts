import { describe, expect, it } from 'vitest'
import { ASSESSMENT_FIELDS, ASSESSMENT_SCHEMA, buildAssessmentPrompt, readAssessment } from './borrowerAssessment'

const good = Object.fromEntries(ASSESSMENT_FIELDS.map((f) => [f, `${f} text`]))

describe('borrower assessment', () => {
  it('asks for all eight fields', () => {
    expect(ASSESSMENT_SCHEMA.required).toEqual([...ASSESSMENT_FIELDS])
    expect(Object.keys(ASSESSMENT_SCHEMA.properties)).toHaveLength(8)
  })
  it('reads a good reply', () => {
    const r = readAssessment(good)
    expect('error' in r).toBe(false)
    expect((r as Record<string, string>).overview).toBe('overview text')
  })
  it('refuses approval language in what the borrower may see, but allows it internally', () => {
    expect(readAssessment({ ...good, next_steps: 'You are pre-approved for $400k.' })).toEqual({ error: 'approval language in next_steps' })
    expect(readAssessment({ ...good, borrower_recommendations: 'This is guaranteed.' })).toEqual({ error: 'approval language in borrower_recommendations' })
    expect('error' in readAssessment({ ...good, underwriting: 'Borrower is approved for nothing yet; verify assets.' })).toBe(false)
    expect('error' in readAssessment({ ...good, strategy: 'Work toward a pre-approval after the credit pull.' })).toBe(false)
  })
  it('needs an overview; nonsense and too-long replies are refused', () => {
    expect(readAssessment({ ...good, overview: ' ' })).toEqual({ error: 'missing overview' })
    expect(readAssessment(null)).toEqual({ error: 'unreadable' })
    expect(readAssessment({ ...good, concerns: 'x'.repeat(4001) })).toEqual({ error: 'concerns too long' })
  })
  it('caps the profile it sends', () => {
    expect(buildAssessmentPrompt({ a: 'x'.repeat(50_000) }).length).toBeLessThan(31_000)
  })
})
