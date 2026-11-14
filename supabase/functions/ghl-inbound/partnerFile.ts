// Which file a partner's message is about (Connor, 2026-11-14): title and
// insurance reply to the request emails, often on several files at once.
// 1. The one file whose borrower's full name or loan number (lender loan #,
//    title GF #, Arive #) is in the subject or text.
// 2. Else the file we last emailed or texted them from.
// 3. Else their newest open file, else their newest file.
// Pure, tested.

export interface PartnerFile {
  loanId: string
  borrowerNames: string[]
  loanNumbers: string[]
  open: boolean
  createdAt: string
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

export function partnerFileFor(text: string, files: PartnerFile[], lastSentLoanId: string | null): string | null {
  if (!files.length) return null
  const w = words(text)
  const sq = squash(text)
  const named = files.filter(
    (f) =>
      f.borrowerNames.some((n) => n.trim().split(/\s+/).length >= 2 && w.includes(words(n))) ||
      f.loanNumbers.some((n) => squash(n).length >= 5 && sq.includes(squash(n))),
  )
  if (named.length === 1) return named[0].loanId
  if (lastSentLoanId && files.some((f) => f.loanId === lastSentLoanId)) return lastSentLoanId
  const newest = (list: PartnerFile[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.loanId ?? null
  return newest(files.filter((f) => f.open)) ?? newest(files)
}
