import { useState } from 'react'
import { cn } from 'cn'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, TextArea } from '@/components/shared'
import { useBookAppointment, useCalendarSlots, type BookingResult } from '@/lib/api/ghl'
import { slotLong, slotsByDay, slotTime } from '@/lib/messaging/appointments'

/**
 * Book appointment (Connor, 2026-11-18): the file's loan officer's open times
 * from GHL (their calendar from Settings → GHL calendars), in Central time.
 * Picking a time and pressing Book books it on GHL right away; GHL sends
 * nothing itself, and a confirmation text is put in the message box to send.
 */
export function BookAppointmentDialog({
  loanId,
  person,
  loName,
  onBooked,
  onClose,
}: {
  loanId: string
  person: { id: string; firstName: string }
  loName: string
  onBooked: (r: BookingResult, minutes: number) => void
  onClose: () => void
}) {
  const slots = useCalendarSlots(loanId, true)
  const book = useBookAppointment()
  const days = slotsByDay(slots.data?.slots ?? [])
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [start, setStart] = useState<string | null>(null)
  const [title, setTitle] = useState(`Call with ${person.firstName}`)
  const [notes, setNotes] = useState('')
  const day = days.find((d) => d.key === dayKey) ?? days[0]

  const submit = () => {
    if (!start) return
    book.mutate(
      { loanId, contactId: person.id, start, title, notes },
      {
        onSuccess: (r) => {
          toast.success(`Booked: ${title}, ${slotLong(r.start)} on ${r.calendar}`)
          if (r.saveError) toast.warning(r.saveError)
          onBooked(r, slots.data?.calendar.minutes ?? 30)
        },
        onError: (e) => {
          toast.error(e.message)
          // A time that was just taken drops off the list.
          if (/taken|no longer open/.test(e.message)) {
            setStart(null)
            void slots.refetch()
          }
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !book.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Book an appointment with {person.firstName}</DialogTitle>
          <DialogDescription>
            On {loName}'s GHL calendar{slots.data ? ` (${slots.data.calendar.name}, ${slots.data.calendar.minutes} minutes)` : ''}. Times are Central. Book puts it on the calendar right away; GHL sends nothing, and a confirmation text is put in the box for you to send.
          </DialogDescription>
        </DialogHeader>

        {slots.isPending ? (
          <p className="text-sm text-muted-foreground">Loading open times…</p>
        ) : slots.error ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{slots.error.message}</p>
        ) : !days.length ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">No open times in the next 14 days on this calendar. Check its availability in GHL.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Day">
              {days.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  role="tab"
                  aria-selected={d.key === day?.key}
                  onClick={() => {
                    setDayKey(d.key)
                    setStart(null)
                  }}
                  className={cn('shrink-0 rounded-lg border px-2.5 py-1.5 text-sm', d.key === day?.key ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground')}
                >
                  {d.label}
                  <span className="ml-1 text-xs text-muted-foreground">{d.slots.length}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {day?.slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStart(s)}
                  className={cn('rounded-md border px-2 py-1.5 text-sm tabular-nums', start === s ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
                >
                  {slotTime(s)}
                </button>
              ))}
            </div>
            <Input label="Title (shows on the GHL calendar)" value={title} onChange={setTitle} required />
            <TextArea label="Notes for the file (optional)" value={notes} onChange={setNotes} rows={2} />
          </div>
        )}

        <DialogFooter className="items-center">
          {start && <span className="mr-auto text-sm">{slotLong(start)}</span>}
          <Button variant="ghost" disabled={book.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!start || !title.trim() || book.isPending} onClick={submit}>
            {book.isPending ? 'Booking…' : 'Book it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
