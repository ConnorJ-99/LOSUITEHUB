import { describe, expect, it } from 'vitest'
import { brandFileProblem, brandPath } from './brandFiles'

describe('logo and signature images', () => {
  it('takes PNG or JPEG up to 2 MB', () => {
    expect(brandFileProblem({ name: 'sig.png', size: 40_000, type: 'image/png' })).toBeNull()
    expect(brandFileProblem({ name: 'logo.jpg', size: 2 * 1024 * 1024, type: 'image/jpeg' })).toBeNull()
  })
  it('explains what is wrong', () => {
    expect(brandFileProblem({ name: 'logo.svg', size: 10, type: 'image/svg+xml' })).toBe("logo.svg isn't a PNG or JPEG. Save it as PNG (best for a signature or logo).")
    expect(brandFileProblem({ name: 'big.png', size: 2 * 1024 * 1024 + 1, type: 'image/png' })).toBe('big.png is over 2 MB. Save a smaller copy.')
    expect(brandFileProblem({ name: 'x.png', size: 0, type: 'image/png' })).toBe('x.png is empty.')
  })
  it("files go in the company's logo folder or the user's own signature folder", () => {
    expect(brandPath('org', 'logo', 'u1', 'MPS Logo.PNG', 'abc')).toBe('org/logo/abc.png')
    expect(brandPath('org', 'signature', 'u1', 'my sig.jpeg', 'abc')).toBe('org/signatures/u1/abc.jpg')
  })
})
