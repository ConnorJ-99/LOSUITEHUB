import { describe, expect, it } from 'vitest'
import { answerPrompt, normalizeAnswer, NOT_COVERED, type AnswerPassage } from './guidelineAnswer'

const passages: AnswerPassage[] = [
  { id: 'p1', lender: 'Bluebonnet Lending (Sample)', document: 'DSCR Guidelines', page: 14, section: '4.2', heading: 'Vesting', body: 'Loans may close in the name of a limited liability company (LLC). All members must personally guarantee the loan.' },
  { id: 'p2', lender: 'Lakeshore Capital (Sample)', document: 'Investor Guide', page: 7, section: null, heading: null, body: 'Short-term rentals are eligible with a 12-month rental history.' },
]

describe('guideline answers', () => {
  it('keeps quotes that are really in the passage (ignoring case, curly quotes and spacing)', () => {
    const r = normalizeAnswer(
      { covered: true, answer: 'Bluebonnet allows LLC vesting with personal guarantees.', citations: [{ passageId: 'p1', quote: '“All members must  personally guarantee the loan.”' }] },
      passages,
    )
    expect(r).toEqual({ covered: true, answer: 'Bluebonnet allows LLC vesting with personal guarantees.', citations: [{ passageId: 'p1', quote: 'All members must  personally guarantee the loan.' }] })
  })
  it('drops made-up quotes and quotes pinned to the wrong passage', () => {
    const r = normalizeAnswer(
      {
        covered: true,
        answer: 'Yes.',
        citations: [
          { passageId: 'p1', quote: 'LLCs are always allowed with no guarantee.' },
          { passageId: 'p2', quote: 'All members must personally guarantee the loan.' },
          { passageId: 'p9', quote: 'Short-term rentals are eligible' },
          { passageId: 'p2', quote: 'eligible with a 12-month rental history' },
        ],
      },
      passages,
    )
    expect(r).toMatchObject({ covered: true, citations: [{ passageId: 'p2', quote: 'eligible with a 12-month rental history' }] })
  })
  it('an answer with no real quote becomes "not covered", never an uncited answer', () => {
    expect(normalizeAnswer({ covered: true, answer: 'LLCs are fine everywhere.', citations: [{ passageId: 'p1', quote: 'fine everywhere' }] }, passages)).toEqual({ covered: false, answer: NOT_COVERED, citations: [] })
    expect(normalizeAnswer({ covered: false, answer: 'They only discuss vesting and rentals.', citations: [] }, passages)).toEqual({ covered: false, answer: `${NOT_COVERED} They only discuss vesting and rentals.`, citations: [] })
    expect(normalizeAnswer(null, passages)).toHaveProperty('error')
  })
  it('tags each passage with its id, lender, document and page', () => {
    const prompt = answerPrompt('Can it close in an LLC?', passages.slice(0, 1), 'DSCR purchase, 720')
    expect(prompt).toContain('The borrower\'s scenario: DSCR purchase, 720')
    expect(prompt).toContain('<passage id="p1" lender="Bluebonnet Lending (Sample)" document="DSCR Guidelines" page="14" section="4.2">\nVesting\nLoans may close')
  })
})
