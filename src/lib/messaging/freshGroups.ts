// New messages grouped by who sent them (Connor, 2026-11-16): five texts from
// Jane are one line ("Jane (5)") on the home page and one pop-up, not five.

export interface FreshLike {
  id: string
  contactId: string | null
  partnerId: string | null
  sentAt: string
}

export interface FreshGroup<T extends FreshLike> {
  /** The person: "c:<contact>" or "p:<partner>" (else the message itself). */
  key: string
  /** Their newest message. */
  latest: T
  count: number
  ids: string[]
}

export const senderKey = (m: FreshLike) => (m.contactId ? `c:${m.contactId}` : m.partnerId ? `p:${m.partnerId}` : `m:${m.id}`)

/** One group per sender, newest sender first. */
export function groupBySender<T extends FreshLike>(list: T[]): FreshGroup<T>[] {
  const groups = new Map<string, FreshGroup<T>>()
  for (const m of list) {
    const key = senderKey(m)
    const g = groups.get(key)
    if (!g) groups.set(key, { key, latest: m, count: 1, ids: [m.id] })
    else {
      g.count++
      g.ids.push(m.id)
      if (Date.parse(m.sentAt) > Date.parse(g.latest.sentAt)) g.latest = m
    }
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.latest.sentAt) - Date.parse(a.latest.sentAt))
}
