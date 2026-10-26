import { describe, expect, it } from 'vitest'
import { storagePathFor, uploadProblem } from './documents'

describe('uploadProblem', () => {
  it('accepts PDFs and photos up to 25 MB', () => {
    expect(uploadProblem({ name: 'contract.pdf', size: 1_000_000, type: 'application/pdf' })).toBeNull()
    expect(uploadProblem({ name: 'page1.jpg', size: 25 * 1024 * 1024, type: 'image/jpeg' })).toBeNull()
  })
  it('explains what is wrong', () => {
    expect(uploadProblem({ name: 'big.pdf', size: 25 * 1024 * 1024 + 1, type: 'application/pdf' })).toBe('big.pdf is over 25 MB.')
    expect(uploadProblem({ name: 'notes.docx', size: 10, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe("notes.docx isn't a PDF or photo.")
    expect(uploadProblem({ name: 'empty.pdf', size: 0, type: 'application/pdf' })).toBe('empty.pdf is empty.')
  })
})

describe('storagePathFor', () => {
  it('puts the file in the company and loan folder with a safe name', () => {
    expect(storagePathFor('org-1', 'loan-2', 'TREC 1-4 (Executed) #2.pdf', 'abc')).toBe('org-1/loan-2/abc-TREC-1-4-Executed-2.pdf')
    expect(storagePathFor('org-1', 'loan-2', 'Contrato año.pdf', 'abc')).toBe('org-1/loan-2/abc-Contrato-ano.pdf')
    expect(storagePathFor('o', 'l', '###', 'abc')).toBe('o/l/abc-file')
  })
})

describe('document kinds', () => {
  it('match the database exactly', async () => {
    const { DOCUMENT_KIND_GROUPS, DOCUMENT_KIND_LABEL } = await import('./documents')
    const scripts = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts).join('\n')
    const created = /create type public\.document_kind as enum \(([^)]*)\)/.exec(sql)![1].match(/'([a-z_0-9]+)'/g)!.map((s) => s.slice(1, -1))
    const added = [...sql.matchAll(/alter type public\.document_kind add value if not exists '([a-z_0-9]+)'/g)].map((m) => m[1])
    const app = DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([k]) => k as string))
    expect([...app].sort()).toEqual([...created, ...added].sort())
    expect(new Set(Object.values(DOCUMENT_KIND_LABEL)).size).toBe(app.length)
  })
})
