import { describe, expect, it } from 'vitest'
import { resolveTags, tagPieces, tagsIn, tagValues } from './mergeTags'

const values = tagValues({
  borrowerFirst: 'Maria',
  sender: { fullName: 'Jamie Lee', title: 'Loan Officer Assistant' },
  lo: { displayName: null, fullName: 'Dave Smith', nmls: '298260', applicationLink: 'https://mps.mortgage/apply/dave', bookingUrl: null, bioUrl: 'https://mps.mortgage/dave' },
  documentUploadLink: 'https://app.mps.mortgage/u/abc',
})

describe('merge tags', () => {
  it('fills relative to the file: lo is the file LO, sender is who sends', () => {
    const r = resolveTags("Hi {{borrower.first_name}}, this is {{sender.first_name}}, {{lo.first_name}}'s loan officer assistant. Apply: {{lo.application_link}}", values)
    expect(r.missing).toEqual([])
    expect(r.text).toBe("Hi Maria, this is Jamie, Dave's loan officer assistant. Apply: https://mps.mortgage/apply/dave")
  })

  it('reports what is missing and keeps the tag', () => {
    const r = resolveTags('Book: {{lo.booking_link}} {{lo.booking_link}}', values)
    expect(r.missing).toEqual(['LO booking link'])
    expect(r.text).toContain('{{lo.booking_link}}')
  })

  it('treats unknown tags as missing', () => {
    expect(resolveTags('{{lo.shoe_size}}', values).missing).toEqual(['unknown field {{lo.shoe_size}}'])
  })

  it('display name wins for first names', () => {
    const v = tagValues({ borrowerFirst: 'Maria Jo', sender: { displayName: 'Jay', fullName: 'Jamie Lee' }, lo: null, documentUploadLink: null })
    expect(v['sender.first_name']).toBe('Jay')
    expect(v['borrower.first_name']).toBe('Maria')
    expect(v['lo.first_name']).toBeNull()
  })

  it('lists and splits tags', () => {
    expect(tagsIn('{{a.b}} x {{ a.b }} {{lo.nmls}}')).toEqual(['a.b', 'lo.nmls'])
    expect(tagPieces('Hi {{borrower.first_name}}!')).toEqual([{ text: 'Hi ' }, { tag: 'borrower.first_name' }, { text: '!' }])
  })
})
