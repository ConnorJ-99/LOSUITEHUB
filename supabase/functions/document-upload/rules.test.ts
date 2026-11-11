import { describe, expect, it } from 'vitest'
import { canUpload, emailMatches, fileProblem, isLocked, linkState, safeFileName, sessionValid, stillNeeded } from './rules'

describe('upload link rules', () => {
  it('email match ignores case and spaces; a co-borrower works; others do not', () => {
    expect(emailMatches(' Pat@Example.com ', ['pat@example.com', null])).toBe(true)
    expect(emailMatches('jo@example.com', ['pat@example.com', 'jo@example.com'])).toBe(true)
    expect(emailMatches('realtor@example.com', ['pat@example.com'])).toBe(false)
    expect(emailMatches('', ['pat@example.com'])).toBe(false)
  })
  it('link state, lock and session', () => {
    const now = new Date('2026-11-11T12:00:00Z')
    expect(linkState({ expiresAt: '2026-11-25T12:00:00Z', revokedAt: null }, now)).toBe('open')
    expect(linkState({ expiresAt: '2026-11-11T12:00:00Z', revokedAt: null }, now)).toBe('expired')
    expect(linkState({ expiresAt: '2026-11-25T12:00:00Z', revokedAt: '2026-11-10T00:00:00Z' }, now)).toBe('revoked')
    expect(isLocked(4)).toBe(false)
    expect(isLocked(5)).toBe(true)
    expect(sessionValid({ sessionHash: 'h', sessionExpiresAt: '2026-11-12T00:00:00Z' }, 'h', now)).toBe(true)
    expect(sessionValid({ sessionHash: 'h', sessionExpiresAt: '2026-11-12T00:00:00Z' }, 'x', now)).toBe(false)
  })
  it('files: PDFs and photos up to 10 MB', () => {
    expect(fileProblem({ size: 2_000_000, type: 'application/pdf' })).toBeNull()
    expect(fileProblem({ size: 3_000_000, type: 'image/HEIC' })).toBeNull()
    expect(fileProblem({ size: 11 * 1024 * 1024, type: 'image/jpeg' })).toMatch(/10 MB/)
    expect(fileProblem({ size: 100, type: 'application/zip' })).toMatch(/PDF or a photo/)
  })
  it('safe file names keep the extension', () => {
    expect(safeFileName('Bank Stmt (Jan).PDF')).toBe('bank-stmt-jan.pdf')
    expect(safeFileName('IMG_0042.heic')).toBe('img-0042.heic')
    expect(safeFileName('???.jpg')).toBe('upload.jpg')
  })
  it('what is still needed and what can take files', () => {
    expect(stillNeeded('rejected')).toBe(true)
    expect(stillNeeded('received')).toBe(false)
    expect(canUpload('received')).toBe(true)
    expect(canUpload('reviewed')).toBe(false)
  })
})
