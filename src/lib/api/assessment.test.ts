import { describe, expect, it } from 'vitest'
import { ASSESSMENT_FIELDS as APP_FIELDS, EMPTY_ASSESSMENT, mergeDraft, type AssessmentText } from './assessment'
import { ASSESSMENT_FIELDS as FN_FIELDS } from '../../../supabase/functions/assistant/borrowerAssessment'

const draft = Object.fromEntries(APP_FIELDS.map((f) => [f, `AI ${f}`])) as AssessmentText

describe('assessment draft merge', () => {
  it('the app and the function list the same fields', () => expect([...APP_FIELDS]).toEqual([...FN_FIELDS]))
  it('fills only empty fields and marks them as AI drafts', () => {
    const current = { ...EMPTY_ASSESSMENT, text: { ...EMPTY_ASSESSMENT.text, overview: 'Mine', strengths: '  ' }, aiFields: ['concerns' as const] }
    const r = mergeDraft(current, draft)
    expect(r.text.overview).toBe('Mine')
    expect(r.text.strengths).toBe('AI strengths')
    expect(r.filled).not.toContain('overview')
    expect(r.filled).toHaveLength(7)
    expect(r.aiFields).toContain('concerns')
    expect(r.aiFields).not.toContain('overview')
  })
  it('an empty draft field leaves the field empty', () => {
    expect(mergeDraft(EMPTY_ASSESSMENT, { ...draft, underwriting: ' ' }).filled).not.toContain('underwriting')
  })
})
