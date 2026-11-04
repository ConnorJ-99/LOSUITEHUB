import { describe, expect, it } from 'vitest'
import { hasLink } from './sendTools'

describe('hasLink', () => {
  it('spots links, which texts never carry', () => {
    for (const s of ['See https://mps.mortgage/x', 'go to www.example.com', 'details at mps.mortgage', 'example.com/loan']) expect(hasLink(s)).toBe(true)
  })
  it('leaves ordinary texts alone', () => {
    for (const s of ['Just emailed your Fee Estimates. Let me know what you think!', 'Call me at 3pm. Rate 6.5 is on the email.', 'Thanks!']) expect(hasLink(s)).toBe(false)
  })
})
