// What a phone or computer notification says (Inbox fully live, Phase 2c).
// Pure and import-free, so it's tested here and pasted with index.ts.

export interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
}

/** The push message the service worker (public/sw.js) shows. Short, and only an in-app link. */
export function pushPayload(n: NotificationRow): string {
  const link = n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/'
  return JSON.stringify({
    id: n.id,
    title: n.title.slice(0, 80),
    body: (n.body ?? '').slice(0, 160),
    link,
    // One alert per kind per conversation on the lock screen: a newer one replaces it.
    tag: `${n.kind}:${link}`,
  })
}

/** GHL-style answers from a push service: these mean the device is gone, so its subscription is removed. */
export const isGone = (status: number | undefined) => status === 404 || status === 410

/** Constant-time comparison for the key (same rule as ghl-inbound: at least 16 characters). */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false
  let diff = given.length ^ expected.length
  for (let i = 0; i < Math.max(given.length, expected.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0)
  return diff === 0
}
