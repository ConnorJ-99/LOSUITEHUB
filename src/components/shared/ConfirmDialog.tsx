import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// "Are you sure?" in LOSuite's own dialog. The browser's built-in confirm()
// isn't shown by every browser (the app's built-in browser and some phones
// answer "Cancel" without asking), so a button that relied on it did nothing.

export interface ConfirmOptions {
  /** The button that goes ahead, e.g. "Delete" or "Choose". */
  confirmLabel?: string
  /** Red button, for deleting. */
  destructive?: boolean
  title?: string
}

interface Pending extends ConfirmOptions {
  message: string
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Asks before doing something; resolves true only if Connor clicks the confirm button. */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // A second question replaces an unanswered first one (which counts as Cancel).
  pending?.resolve(false)
  return new Promise((resolve) => {
    pending = { ...options, message, resolve }
    emit()
  })
}

function answer(ok: boolean) {
  const p = pending
  pending = null
  emit()
  p?.resolve(ok)
}

/** Mounted once at the app root; shows whatever confirmAction() is asking. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
  )
  return (
    <Dialog open={!!current} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{current?.title ?? 'Are you sure?'}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">{current?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button variant={current?.destructive ? 'destructive' : 'default'} onClick={() => answer(true)} autoFocus>
            {current?.confirmLabel ?? 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
