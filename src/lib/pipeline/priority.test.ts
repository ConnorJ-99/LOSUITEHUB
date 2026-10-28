import { describe, expect, it } from 'vitest'
import { priorityTone, toneBorder } from './priority'

const today = '2026-10-27'

describe('priority color for list cards', () => {
  it('overdue or due today is urgent', () => {
    expect(priorityTone(['2026-10-20'], 'contacted', today)).toBe('urgent')
    expect(priorityTone([null, '2026-10-27'], 'contacted', today)).toBe('urgent')
  })
  it('due within 7 days is this week; later is plain', () => {
    expect(priorityTone(['2026-11-03'], 'contacted', today)).toBe('week')
    expect(priorityTone(['2026-11-04'], 'contacted', today)).toBeNull()
    expect(priorityTone([null], 'contacted', today)).toBeNull()
  })
  it('nurture files are green unless a task is coming up', () => {
    expect(priorityTone([], 'nurture', today)).toBe('nurture')
    expect(priorityTone(['2026-10-27'], 'nurture', today)).toBe('urgent')
  })
  it('gives each tone a left border', () => {
    expect(toneBorder('urgent')).toBe('border-l-4 border-l-urgent')
    expect(toneBorder(null)).toBe('')
  })
})
