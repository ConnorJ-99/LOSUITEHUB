import { describe, expect, it } from 'vitest'
import { numbersReady, portalInvite, portalUrl } from './messages'

const url = portalUrl('https://app.mps.mortgage/', 'a'.repeat(64))

describe('portal messages', () => {
  it('the link is the upload page address', () => {
    expect(url).toBe(`https://app.mps.mortgage/u/${'a'.repeat(64)}`)
  })
  it('the invite names what the portal does; home requests only on a purchase', () => {
    const p = portalInvite({ firstName: 'Maya', loName: 'Connor Jacquart', url, isPurchase: true })
    expect(p.text).toBe(`Hi Maya, here's your secure loan portal. Check your status, upload documents, see your letters and estimates, and request numbers for a home: ${url} You'll confirm your email to open it. - Connor`)
    expect(p.email).toContain('• Request a pre-approval letter or payment estimate for a home you like')
    expect(portalInvite({ firstName: 'Maya', loName: 'Connor Jacquart', url, isPurchase: false }).email).not.toContain('Request a pre-approval')
  })
  it('numbers ready', () => {
    const m = numbersReady({ firstName: 'Maya', loName: 'Connor Jacquart', url, address: '123 Main St' })
    expect(m.text).toBe(`Hi Maya, your numbers for 123 Main St are ready. View them here: ${url} - Connor`)
    expect(m.subject).toBe('Your numbers for 123 Main St')
  })
})
