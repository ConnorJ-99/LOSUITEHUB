import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronRightIcon, SparklesIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssistantChat } from './AssistantChat'

const OPEN_EVENT = 'mpshq:open-assistant'
const PANEL_PX = 400
const DESKTOP = '(min-width: 768px)'

// Whether a borrower file (with its assistant) is open, so the phone's top bar can show the button.
let fileOpen = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * The assistant button in the phone's top bar, shown only inside a borrower
 * file (computers use the tab on the right edge). It sits in the bar so it
 * never pushes or covers the file's own buttons.
 */
export function MobileAssistantButton() {
  const open = useSyncExternalStore(subscribe, () => fileOpen > 0)
  if (!open) return null
  return (
    <Button size="icon" variant="ghost" className="text-primary" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} aria-label="Open the assistant" title="Assistant">
      <SparklesIcon />
    </Button>
  )
}

/** The visible screen above the phone keyboard, so the sheet's box is never hidden. */
function useVisibleHeight(active: boolean) {
  const [h, setH] = useState<{ height: number; bottom: number; width: number; left: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!active || !vv) return
    // A page wider than the phone may be scrolled sideways: line the sheet up with the screen.
    if (window.scrollX) window.scrollTo(0, window.scrollY)
    const update = () => setH({ height: vv.height, bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop), width: vv.width, left: 0 })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [active])
  return h
}

/**
 * The assistant inside a borrower's file. On a computer: a slim tab on the
 * right edge opens a 400px panel that pushes the page over (nothing is
 * covered). On a phone: the header's Assistant button opens a sheet from the
 * bottom (swipe the handle down, or tap ✕, to close), sized to the screen
 * above the keyboard.
 */
export function FileAssistant({ loanId, borrowerName }: { loanId: string; borrowerName: string }) {
  const [open, setOpen] = useState(false)
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP)
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, show)
    fileOpen++
    notify()
    return () => {
      window.removeEventListener(OPEN_EVENT, show)
      fileOpen--
      notify()
    }
  }, [])
  // A different file: start closed.
  const [seen, setSeen] = useState(loanId)
  if (seen !== loanId) {
    setSeen(loanId)
    setOpen(false)
  }

  // Computer: push the page left while the panel is open, so the file's buttons stay visible.
  useEffect(() => {
    if (!open || !desktop) return
    const before = document.body.style.marginRight
    document.body.style.marginRight = `${PANEL_PX}px`
    return () => {
      document.body.style.marginRight = before
    }
  }, [open, desktop])

  const visible = useVisibleHeight(open && !desktop)
  const dragStart = useRef<number | null>(null)
  const [drag, setDrag] = useState(0)

  const title = (
    <div className="min-w-0">
      <p className="font-semibold">Assistant</p>
      <p className="truncate text-xs text-muted-foreground">Working in {borrowerName}'s file</p>
    </div>
  )

  if (desktop) {
    return open ? (
      <aside className="fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-card shadow-xl" style={{ width: PANEL_PX }} aria-label="Assistant">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          {title}
          <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close the assistant" title="Close">
            <ChevronRightIcon />
          </Button>
        </div>
        <AssistantChat loanId={loanId} borrowerName={borrowerName} className="flex-1" />
      </aside>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-1/2 right-0 z-30 flex -translate-y-1/2 items-center gap-1.5 rounded-l-lg border border-r-0 bg-card px-1.5 py-3 text-xs font-medium text-primary shadow-soft hover:bg-muted [writing-mode:vertical-rl]"
        aria-label="Open the assistant"
      >
        <SparklesIcon className="size-3.5 rotate-90" />
        Assistant
      </button>
    )
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close the assistant" className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
      <div
        className="absolute flex flex-col rounded-t-2xl bg-card shadow-xl transition-transform"
        style={{
          bottom: visible?.bottom ?? 0,
          left: visible?.left ?? 0,
          width: visible?.width ?? '100%',
          height: visible ? Math.min(visible.height - 12, window.innerHeight * 0.94) : '94dvh',
          transform: drag ? `translateY(${drag}px)` : undefined,
          transitionDuration: drag ? '0ms' : undefined,
        }}
        role="dialog"
        aria-label="Assistant"
      >
        <div
          className="touch-none pt-2"
          onTouchStart={(e) => (dragStart.current = e.touches[0].clientY)}
          onTouchMove={(e) => dragStart.current !== null && setDrag(Math.max(0, e.touches[0].clientY - dragStart.current))}
          onTouchEnd={() => {
            if (drag > 90) setOpen(false)
            setDrag(0)
            dragStart.current = null
          }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            {title}
            <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close the assistant">
              <XIcon />
            </Button>
          </div>
        </div>
        <AssistantChat loanId={loanId} borrowerName={borrowerName} onNavigate={() => setOpen(false)} className="flex-1" />
      </div>
    </div>
  )
}
