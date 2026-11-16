// "Move to Nurture" (Connor, 2026-11-16): the one window behind the header's
// Move to Nurture button and Change status → Nurture (and Edit obstacles while
// in Nurture). At least one readiness obstacle; a target time frame and a note
// are optional. The file, its people, GHL link, history and 1003 stay as they
// are; lead follow-ups stop because the file is no longer a lead.
import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, TextArea, ToggleChip } from '@/components/shared'
import { useMoveToNurture } from '@/lib/api/nurture'
import { customObstacle, isCustom, OBSTACLE_GROUPS, obstacleLabel, obstacleSummary } from '@/lib/nurture/obstacles'
import { TIMELINE_OPTIONS } from '@/lib/pipeline/timeline'

export interface NurtureTarget {
  loanId: string
  borrowerName: string
  /** Editing while already in Nurture. */
  editing?: { obstacles: string[]; target: string | null; note: string | null }
}

export function MoveToNurtureDialog({ target, onClose }: { target: NurtureTarget; onClose: () => void }) {
  const move = useMoveToNurture()
  const [picked, setPicked] = useState<string[]>(target.editing?.obstacles ?? [])
  const [typing, setTyping] = useState('')
  const [timeframe, setTimeframe] = useState(target.editing?.target ?? '')
  const [note, setNote] = useState(target.editing?.note ?? '')
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))
  const addCustom = () => {
    const c = customObstacle(typing)
    if (c && !picked.includes(c)) setPicked((p) => [...p, c])
    setTyping('')
  }
  const save = () => {
    const extra = customObstacle(typing)
    const obstacles = extra && !picked.includes(extra) ? [...picked, extra] : picked
    if (!obstacles.length) return toast.error('Pick at least one readiness obstacle.')
    move.mutate(
      { loanId: target.loanId, obstacles, target: timeframe.trim() || null, note: note.trim() || null, summary: obstacleSummary(obstacles) },
      {
        onSuccess: () => {
          toast.success(target.editing ? 'Obstacles saved' : `${target.borrowerName} moved to Nurture`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }
  const customs = picked.filter(isCustom)
  const options = TIMELINE_OPTIONS.map((o) => ({ value: o, label: o }))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.editing ? 'Readiness obstacles' : `Move ${target.borrowerName} to Nurture`}</DialogTitle>
          <DialogDescription>
            {target.editing
              ? 'What stands between them and a mortgage today.'
              : 'For buyers who want to buy but aren’t mortgage-ready yet. Their file, messages, documents and 1003 stay as they are; lead follow-ups stop.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Readiness obstacles <span className="text-destructive">*</span>
          </p>
          {OBSTACLE_GROUPS.map((g) => (
            <div key={g.id}>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((i) => (
                  <ToggleChip key={i.key} label={i.label} pressed={picked.includes(i.key)} onChange={() => toggle(i.key)} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Something else</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input label="Type an obstacle" value={typing} onChange={setTyping} placeholder="e.g. Finishing probation at a new job" />
              </div>
              <Button type="button" variant="outline" className="self-end" onClick={addCustom} disabled={!typing.trim()}>
                Add
              </Button>
            </div>
            {customs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {customs.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {obstacleLabel(c)}
                    <button type="button" onClick={() => toggle(c)} aria-label={`Remove ${obstacleLabel(c)}`}>
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <FormGrid>
            <Select label="Target purchase time frame" value={TIMELINE_OPTIONS.includes(timeframe as never) ? timeframe : ''} options={options} onChange={(v) => setTimeframe(v ?? '')} span={3} />
            <Input label="…or in their words" value={timeframe} onChange={setTimeframe} placeholder="e.g. Next spring" span={3} />
            <TextArea label="Note (optional)" value={note} onChange={setNote} rows={2} span={6} />
          </FormGrid>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={move.isPending || (!picked.length && !typing.trim())}>
            {move.isPending ? 'Saving…' : target.editing ? 'Save' : 'Move to Nurture'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
