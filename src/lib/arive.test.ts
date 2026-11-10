import { describe, expect, it } from 'vitest'
import { ariveTemplateProblem, ariveUrl } from './arive'

const T = 'https://app.arive.com/loans/{number}/overview'

describe('the Arive link setting', () => {
  it('accepts an https address with {number}, and blank', () => {
    expect(ariveTemplateProblem(T)).toBeNull()
    expect(ariveTemplateProblem('')).toBeNull()
    expect(ariveTemplateProblem(null)).toBeNull()
  })
  it('refuses http, a missing {number}, or something that is not an address', () => {
    expect(ariveTemplateProblem('http://app.arive.com/loans/{number}')).toMatch(/https/)
    expect(ariveTemplateProblem('https://app.arive.com/loans/12345')).toMatch(/\{number\}/)
    expect(ariveTemplateProblem('https://my arive/{number}')).toMatch(/web address/)
  })
})

describe('the address for a loan', () => {
  it('fills in the number', () => {
    expect(ariveUrl(T, '12345')).toBe('https://app.arive.com/loans/12345/overview')
    expect(ariveUrl('https://x.com/?loan={number}&tab={number}', ' 77 ')).toBe('https://x.com/?loan=77&tab=77')
  })
  it('encodes a number with spaces or symbols', () => {
    expect(ariveUrl(T, 'MPS 12/34')).toBe('https://app.arive.com/loans/MPS%2012%2F34/overview')
  })
  it('gives nothing without a number or a usable link', () => {
    expect(ariveUrl(T, null)).toBeNull()
    expect(ariveUrl(T, '  ')).toBeNull()
    expect(ariveUrl(null, '12345')).toBeNull()
    expect(ariveUrl('http://bad/{number}', '12345')).toBeNull()
  })
})
