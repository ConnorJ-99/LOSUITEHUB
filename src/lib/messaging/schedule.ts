// Scheduling a message for later (Inbox fully live, Phase 2a): the person
// picks a day and a time in Central time, MPS HQ stores the exact moment.
// Pure, so it's tested.

const TZ = 'America/Chicago'

const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The Central day ("2026-11-04") and time ("09:30") of a moment. */
export function toCentral(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** The moment a Central day and time ("2026-11-04", "09:30") happens; null if they aren't a real day and time. */
export function fromCentral(date: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || !t) return null
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(t[1]), Number(t[2])]
  if (h > 23 || mi > 59) return null
  const wanted = Date.UTC(y, mo - 1, d, h, mi)
  // Start as if Central were UTC, then correct by the difference twice (covers daylight saving changes).
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const c = toCentral(new Date(guess))
    const [cy, cmo, cd] = c.date.split('-').map(Number)
    const [ch, cmi] = c.time.split(':').map(Number)
    guess += wanted - Date.UTC(cy, cmo - 1, cd, ch, cmi)
  }
  const back = toCentral(new Date(guess))
  return back.date === date && back.time === time.padStart(5, '0') ? new Date(guess) : null
}

/** "Wed, Nov 4 at 9:30 AM" in Central time. */
export function scheduleLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d).replace(/, (\d+:\d+)/, ' at $1')
}

/** A sensible first pick: tomorrow at 9:00 AM Central. */
export function defaultSchedule(now: Date): { date: string; time: string } {
  const tomorrow = toCentral(new Date(now.getTime() + 24 * 3600e3))
  return { date: tomorrow.date, time: '09:00' }
}
