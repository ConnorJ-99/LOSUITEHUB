import { describe, expect, it } from 'vitest'
import { myHomeInvite, myHomeUrl, numbersReady, portalInvite, portalUrl, readyLinkFor } from './messages'

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
  it('the MyHome invite carries the plain MyHome address and never the code', () => {
    const m = myHomeInvite({ firstName: 'Maya', loName: 'Connor Jacquart', url: myHomeUrl('https://app.mps.mortgage'), closed: true })
    expect(m.text).toBe("Hi Maya, here's MyHome, your account with MPS Mortgage. You can keep an eye on your home's value and equity, and find your closing documents: https://app.mps.mortgage/myhome Sign in with your email and the 6-digit MyHome code from our email. - Connor")
    expect(m.subject).toBe('Your MyHome account')
    expect(myHomeInvite({ firstName: 'Maya', loName: 'Connor', url: 'u', closed: false }).text).toContain('track your loan and send documents')
  })
  it('numbers ready points to MyHome once they use it, else the portal link, else nowhere', () => {
    const token = 'a'.repeat(64)
    expect(readyLinkFor('https://app.mps.mortgage/', { myhomeStatus: 'active', portalToken: token })).toEqual({ url: 'https://app.mps.mortgage/myhome', myhome: true })
    expect(readyLinkFor('https://app.mps.mortgage', { myhomeStatus: 'invited', portalToken: token })).toEqual({ url, myhome: false })
    expect(readyLinkFor('https://app.mps.mortgage', { myhomeStatus: 'off', portalToken: null })).toBeNull()
    expect(readyLinkFor('https://app.mps.mortgage', { myhomeStatus: null, portalToken: null })).toBeNull()
    const m = numbersReady({ firstName: 'Maya', loName: 'Connor Jacquart', url: myHomeUrl('https://app.mps.mortgage'), address: '123 Main St', myhome: true })
    expect(m.email).toContain('You can view them in MyHome:\nhttps://app.mps.mortgage/myhome')
    expect(m.text).toBe('Hi Maya, your numbers for 123 Main St are ready. View them here: https://app.mps.mortgage/myhome - Connor')
  })
})
