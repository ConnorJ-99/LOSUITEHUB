import { describe, expect, it } from 'vitest'
import {
  ariveLoginProblem,
  badgeColor,
  faviconUrl,
  initials,
  isLogoUrl,
  lendersMissingPortal,
  linksIn,
  logoCandidates,
  matchesSearch,
  normalizeUrl,
  pinFor,
  pinnedItems,
  portalLenders,
  urlProblem,
  type Pin,
  type PortalLender,
  type QuickLink,
} from './links'

const lender = (name: string, over: Partial<PortalLender> = {}): PortalLender => ({ id: name, name, shortName: null, status: 'approved', portalUrl: `https://${name.toLowerCase()}.example.com`, logoPath: null, ...over })
const link = (id: string, over: Partial<QuickLink> = {}): QuickLink => ({ id, category: 'county_tax', name: id, url: `https://${id}.example.com`, secondaryUrl: null, subtitle: null, logoPath: null, sortOrder: 100, ...over })
const pin = (linkType: Pin['linkType'], linkId: string, sortOrder: number): Pin => ({ id: `${linkType}-${linkId}`, linkType, linkId, sortOrder })

describe('urls', () => {
  it('adds https:// to a pasted address', () => {
    expect(normalizeUrl(' www.dallascad.org ')).toBe('https://www.dallascad.org')
    expect(normalizeUrl('http://x.com')).toBe('http://x.com')
    expect(normalizeUrl('  ')).toBeNull()
  })
  it('checks addresses', () => {
    expect(urlProblem('')).toBeNull()
    expect(urlProblem('', true)).toBe('Enter the web address.')
    expect(urlProblem('www.tad.org')).toBeNull()
    expect(urlProblem('javascript:alert(1)')).toMatch(/https/)
    expect(urlProblem('https://no spaces.com')).toMatch(/spaces/)
    expect(urlProblem('https://localhost')).toMatch(/isn't/)
  })
  it('the Arive login ends in .myarive.com', () => {
    expect(ariveLoginProblem(null)).toBeNull()
    expect(ariveLoginProblem('https://mpsmortgage.myarive.com')).toBeNull()
    expect(ariveLoginProblem('mpsmortgage.myarive.com/login')).toBeNull()
    expect(ariveLoginProblem('http://mpsmortgage.myarive.com')).toMatch(/https/)
    expect(ariveLoginProblem('https://myarive.com.evil.com')).toMatch(/myarive\.com/)
    expect(ariveLoginProblem('https://evil.com/x.myarive.com')).toMatch(/myarive\.com/)
  })
})

describe('logos', () => {
  it("uses the site's icon from the portal's domain", () => {
    expect(faviconUrl('https://portal.uwm.com/login?x=1')).toBe('https://www.google.com/s2/favicons?domain=portal.uwm.com&sz=128')
    expect(faviconUrl(null)).toBeNull()
  })
  it('tries the logo, then the icon', () => {
    expect(logoCandidates('https://cdn.example.com/a.png', 'https://p.example.com')).toEqual(['https://cdn.example.com/a.png', 'https://www.google.com/s2/favicons?domain=p.example.com&sz=128'])
    expect(logoCandidates(null, null)).toEqual([])
  })
  it('makes initials and a steady color', () => {
    expect(initials('United Wholesale Mortgage')).toBe('UW')
    expect(initials('Newfi')).toBe('NE')
    expect(initials('A&D Mortgage')).toBe('AD')
    expect(initials('')).toBe('?')
    expect(badgeColor('Newfi')).toBe(badgeColor('newfi'))
  })
  it('tells a pasted logo from an uploaded one', () => {
    expect(isLogoUrl('https://x.com/a.png')).toBe(true)
    expect(isLogoUrl('org-id/abc.png')).toBe(false)
  })
})

describe('search', () => {
  it('matches every word anywhere', () => {
    expect(matchesSearch('', 'x')).toBe(true)
    expect(matchesSearch('dal tax', 'Dallas', 'County tax and appraisal')).toBe(true)
    expect(matchesSearch('dal hood', 'Dallas')).toBe(false)
  })
})

describe('lender portals', () => {
  const lenders = [lender('Zeta'), lender('Acme'), lender('Hidden', { showInQuickLinks: false }), lender('NoPortal', { portalUrl: null }), lender('Blank', { portalUrl: '  ' }), lender('Gone', { portalUrl: null, status: 'inactive' })]
  it('lists lenders with a portal link that are shown, A–Z', () => {
    expect(portalLenders(lenders).map((l) => l.name)).toEqual(['Acme', 'Zeta'])
  })
  it('lists lenders missing a portal link, skipping hidden and inactive', () => {
    expect(lendersMissingPortal(lenders).map((l) => l.name)).toEqual(['Blank', 'NoPortal'])
  })
})

describe('links and pins', () => {
  it('sorts a category by its order, then name', () => {
    const links = [link('b', { sortOrder: 20 }), link('a', { sortOrder: 20 }), link('c', { sortOrder: 10 }), link('x', { category: 'other' })]
    expect(linksIn(links, 'county_tax').map((l) => l.id)).toEqual(['c', 'a', 'b'])
  })
  it('shows pins in pin order and drops ones that no longer show', () => {
    const lenders = [lender('Acme'), lender('Hidden', { showInQuickLinks: false })]
    const links = [link('dallas')]
    const pins = [pin('quick_link', 'dallas', 2), pin('lender', 'Acme', 1), pin('lender', 'Hidden', 3), pin('quick_link', 'deleted', 4)]
    expect(pinnedItems(pins, lenders, links).map((p) => p.pin.linkId)).toEqual(['Acme', 'dallas'])
    expect(pinFor(pins, 'lender', 'Acme')?.sortOrder).toBe(1)
    expect(pinFor(pins, 'quick_link', 'Acme')).toBeUndefined()
  })
})
