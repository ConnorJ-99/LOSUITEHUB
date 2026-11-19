import { describe, expect, it } from 'vitest'
import { buildTranslatePrompt, keptParts, readTranslation } from './translate'

describe('message translation (AI)', () => {
  it('accepts a plain translation', () => {
    expect(readTranslation({ translation: ' Hello, I have a question about the loan. ' }, 'Hola, tengo una pregunta sobre el préstamo.')).toEqual({
      translation: 'Hello, I have a question about the loan.',
    })
  })

  it('refuses a reply that drops or changes a merge tag or link', () => {
    const original = 'Book a time here: {{lo.booking_link}} or see https://mps.mortgage/apply.'
    expect(readTranslation({ translation: 'Reserve una hora aquí: {{lo.booking_link}} o vea https://mps.mortgage/apply.' }, original)).toEqual({
      translation: 'Reserve una hora aquí: {{lo.booking_link}} o vea https://mps.mortgage/apply.',
    })
    expect(readTranslation({ translation: 'Reserve una hora aquí: {{lo.enlace}} o vea https://mps.mortgage/apply.' }, original)).toEqual({ error: 'changed a link or field' })
    expect(readTranslation({ translation: 'Reserve una hora aquí: {{lo.booking_link}}.' }, original)).toEqual({ error: 'changed a link or field' })
  })

  it('refuses empty, unreadable and runaway replies', () => {
    expect(readTranslation({ translation: '  ' }, 'Hola')).toEqual({ error: 'empty' })
    expect(readTranslation(null, 'Hola')).toEqual({ error: 'unreadable' })
    expect(readTranslation({ translation: 'x'.repeat(500) }, 'Hola')).toEqual({ error: 'too long' })
  })

  it('compares tags without spacing or case differences', () => {
    expect(keptParts('{{ LO.booking_link }}')).toEqual(keptParts('{{lo.booking_link}}'))
  })

  it('says which way to translate and wraps the message as data', () => {
    expect(buildTranslatePrompt('to_en', 'Hola')).toContain('into English')
    expect(buildTranslatePrompt('to_es', 'Hi')).toContain('into Spanish')
    expect(buildTranslatePrompt('to_es', 'Hi')).toContain('<message>\nHi\n</message>')
  })
})
