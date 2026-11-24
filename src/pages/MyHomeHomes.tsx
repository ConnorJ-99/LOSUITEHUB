// MyHome: "Homes I like" on a Nurture purchase file (Connor, 2026-11-24: "add
// properties to MyHome, so borrowers can submit properties"). While they get
// ready, borrowers save homes they like (address, price, listing link, a
// note). Each one goes on the file's Properties as interested and {LO} gets a
// note and a notice; no letter or estimate is asked for yet (open purchase
// files have My properties → Request numbers for that).
import { useState } from 'react'
import { ExternalLinkIcon, PlusIcon } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { addHome } from '@/lib/myhome/api'
import type { MyHomeNurture } from '../../supabase/functions/myhome/rules'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const input = 'mt-1 h-12 w-full rounded-lg border border-input bg-white px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20'
const STATUS: Record<string, string> = { offer_made: 'Offer made', under_contract: 'Under contract', passed: 'Passed' }
const dollars = (s: string) => {
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function HomesILike({ loanId, homes, loFirst, onChanged, onGone }: { loanId: string; homes: MyHomeNurture['homes']; loFirst: string; onChanged: () => void; onGone: () => void }) {
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  return (
    <section className={card} aria-labelledby="myhome-homes">
      <h2 id="myhome-homes" className="text-lg font-bold tracking-tight">
        Homes I like
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Found a home you like? Save it here and {loFirst} will see it. When you're ready, {loFirst} can run the numbers on it.</p>
      {saved && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">Saved {saved}. {loFirst} can see it now.</p>}
      {homes.length > 0 && (
        <ul className="mt-3 divide-y">
          {homes.map((h) => (
            <li key={h.id} className="flex items-start gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{h.address}</p>
                <p className="text-muted-foreground">
                  {[h.city, h.price != null ? formatCurrency(h.price) : null, STATUS[h.status]].filter(Boolean).join(' · ')}
                </p>
              </div>
              {h.link && (
                <a href={h.link} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 font-medium text-primary">
                  Listing <ExternalLinkIcon className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <HomeForm
          loanId={loanId}
          onDone={(address) => {
            setAdding(false)
            setSaved(address)
            onChanged()
          }}
          onCancel={() => setAdding(false)}
          onGone={onGone}
        />
      ) : (
        <button type="button" onClick={() => (setAdding(true), setSaved(null))} className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-base font-semibold text-primary">
          <PlusIcon className="size-5" /> Add a home
        </button>
      )}
    </section>
  )
}

function HomeForm({ loanId, onDone, onCancel, onGone }: { loanId: string; onDone: (address: string) => void; onCancel: () => void; onGone: () => void }) {
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [zip, setZip] = useState('')
  const [priceText, setPriceText] = useState('')
  const [link, setLink] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const l = link.trim()
    if (l && !/^https:\/\//i.test(l)) return setError('The listing link should start with https://')
    setBusy(true)
    setError(null)
    const r = await addHome(loanId, { address: address.trim(), city: city.trim() || null, zip: zip.trim() || null, price: dollars(priceText), link: l || null, notes: notes.trim() || null })
    setBusy(false)
    if (r.status === 200) return onDone(address.trim())
    if (r.status === 401 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not save. Try again.')
  }
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-[#F4F7FB] p-4">
      <label className="block text-sm font-medium">
        Street address
        <input className={input} maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 1420 Oak Ridge Dr" autoComplete="off" />
      </label>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <label className="block text-sm font-medium">
          City
          <input className={input} maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          ZIP
          <input className={input} inputMode="numeric" maxLength={10} value={zip} onChange={(e) => setZip(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Price (optional)
        <span className="relative block">
          <span className="absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-muted-foreground">$</span>
          <input className={`${input} pl-7`} inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="0" />
        </span>
      </label>
      <label className="block text-sm font-medium">
        Listing link (optional)
        <input className={input} type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.zillow.com/…" />
      </label>
      <label className="block text-sm font-medium">
        What do you like about it? (optional)
        <textarea className={`${input} h-auto min-h-16 py-2`} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="h-12 flex-1 rounded-lg border bg-white text-base font-medium">
          Cancel
        </button>
        <button type="button" disabled={busy || !address.trim()} onClick={() => void save()} className="h-12 flex-[2] rounded-lg bg-primary text-base font-semibold text-white disabled:opacity-60">
          {busy ? 'Saving…' : 'Save this home'}
        </button>
      </div>
    </div>
  )
}
