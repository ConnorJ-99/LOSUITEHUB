import { describe, expect, it } from 'vitest'
import { looksSpanish } from './language'

describe('looksSpanish', () => {
  it('spots everyday Spanish texts', () => {
    expect(looksSpanish('Hola, tengo una pregunta sobre el préstamo')).toBe(true)
    expect(looksSpanish('¿Cuándo podemos hablar?')).toBe(true)
    expect(looksSpanish('Gracias')).toBe(true)
    expect(looksSpanish('Buenos días, ya le mandé los documentos')).toBe(true)
    expect(looksSpanish('Sí, está bien')).toBe(true)
  })

  it('leaves English texts alone', () => {
    expect(looksSpanish('Hi, I sent the documents this morning')).toBe(false)
    expect(looksSpanish('Thanks!')).toBe(false)
    expect(looksSpanish('No')).toBe(false)
    expect(looksSpanish('ok')).toBe(false)
    expect(looksSpanish('Can we talk about the casa on Elm tomorrow?')).toBe(false)
    expect(looksSpanish('')).toBe(false)
    expect(looksSpanish(null)).toBe(false)
  })

  it('handles English with a Spanish name in it', () => {
    expect(looksSpanish('This is José, I will call you at 3')).toBe(false)
  })
})
