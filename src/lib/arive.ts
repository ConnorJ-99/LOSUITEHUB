// "Open in Arive": the company's Arive loan link is an address copied from the
// browser with the loan number swapped for {number}. Pure, tested.

export const ARIVE_PLACEHOLDER = '{number}'

/** Why a typed Arive link can't be saved, or null when it's fine (blank is fine: no link). */
export function ariveTemplateProblem(template: string | null | undefined): string | null {
  const t = template?.trim() ?? ''
  if (!t) return null
  if (!/^https:\/\//i.test(t)) return 'The Arive link must start with https://'
  if (!t.includes(ARIVE_PLACEHOLDER)) return 'Put {number} where the loan number goes in the address'
  try {
    new URL(t.replaceAll(ARIVE_PLACEHOLDER, '0'))
  } catch {
    return "That isn't a web address"
  }
  return null
}

/** The address for one loan, with the number filled in (URL-encoded), or null without a usable link or number. */
export function ariveUrl(template: string | null | undefined, loanNumber: string | null | undefined): string | null {
  const n = loanNumber?.trim()
  if (!n || !template?.trim() || ariveTemplateProblem(template)) return null
  return template.trim().replaceAll(ARIVE_PLACEHOLDER, encodeURIComponent(n))
}
