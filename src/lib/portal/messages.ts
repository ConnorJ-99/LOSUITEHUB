// The borrower portal's drafted messages (Stage 2): the invite with the
// portal link and "your numbers are ready". Built in code, never sent on their
// own: they go to the Action Queue for Connor's click. Texts may carry the
// portal link (Connor, 2026-11-12, his third link exception after shared
// estimates and upload links).

export const portalUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/u/${token}`

const firstOf = (name: string) => name.split(/\s+/)[0] || name

/** The invite: where to see the loan's status, upload documents and request numbers. */
export function portalInvite(v: { firstName: string; loName: string; url: string; isPurchase: boolean }) {
  const me = firstOf(v.loName)
  const extra = v.isPurchase ? ', see your letters and estimates, and request numbers for a home' : ' and see your letters and estimates'
  const text = `Hi ${v.firstName}, here's your secure loan portal. Check your status, upload documents${extra}: ${v.url} You'll confirm your email to open it. - ${me}`
  const email = [
    `Hi ${v.firstName},`,
    '',
    "Here's your secure loan portal:",
    v.url,
    '',
    'In it you can:',
    '• See where your loan stands',
    '• Upload the documents I need (photos or PDFs)',
    '• Open the letters and estimates I share with you',
    ...(v.isPurchase ? ['• Request a pre-approval letter or payment estimate for a home you like'] : []),
    '',
    "You'll confirm your email address to open it.",
    '',
    'Thanks,',
    v.loName,
  ].join('\n')
  return { text, subject: 'Your loan portal', email }
}

/** "Your numbers for 123 Main St are ready" after a letter or estimate for a requested home is published. */
export function numbersReady(v: { firstName: string; loName: string; url: string; address: string }) {
  const text = `Hi ${v.firstName}, your numbers for ${v.address} are ready. View them here: ${v.url} - ${firstOf(v.loName)}`
  const email = [`Hi ${v.firstName},`, '', `Your numbers for ${v.address} are ready. You can view them in your loan portal:`, v.url, '', 'Let me know if you have any questions.', '', 'Thanks,', v.loName].join('\n')
  return { text, subject: `Your numbers for ${v.address}`, email }
}
