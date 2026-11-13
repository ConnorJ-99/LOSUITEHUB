// A document shown inside MPS HQ (Stage 4d-2): a PDF page by page with zoom
// (pdfjs-dist, drawn on a canvas), or a photo. Given a quote the AI read, it
// jumps to that page and highlights the words (findQuote); when it can't
// point to them (a scan, a photo, or a quote not on the page) it says so in
// a yellow bar with what the AI read.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon, MinusIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadDocument, type LoanDocument } from '@/lib/api/documents'
import { findQuote } from '@/lib/documents/findQuote'
import { openPdf } from '@/lib/documents/pdfText'

type Pdf = Awaited<ReturnType<typeof openPdf>>

export interface ViewerTarget {
  page: number | null
  quote: string
  value: string | number | null
  /** Changes every click, so clicking the same figure again jumps back to it. */
  nonce: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function DocumentViewer({ doc, target }: { doc: Pick<LoanDocument, 'id' | 'storagePath' | 'contentType' | 'fileName'>; target: ViewerTarget | null }) {
  const isPdf = (doc.contentType ?? '').includes('pdf') || doc.fileName.toLowerCase().endsWith('.pdf')
  const [pdf, setPdf] = useState<Pdf | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [missed, setMissed] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  // Load the file once.
  useEffect(() => {
    let gone = false
    let opened: Pdf | null = null
    let url: string | null = null
    setPdf(null)
    setImageUrl(null)
    setError(null)
    setPage(1)
    downloadDocument(doc)
      .then(async (blob) => {
        if (gone) return
        if (isPdf) {
          opened = await openPdf(await blob.arrayBuffer())
          if (gone) return void opened.destroy()
          setPdf(opened)
        } else {
          url = URL.createObjectURL(blob)
          setImageUrl(url)
        }
      })
      .catch((e: Error) => !gone && setError(e.message))
    return () => {
      gone = true
      void opened?.destroy()
      if (url) URL.revokeObjectURL(url)
    }
    // One document at a time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  // A new target: go to its page.
  useEffect(() => {
    if (target?.page && pdf) setPage(Math.min(Math.max(1, target.page), pdf.numPages))
  }, [target, pdf])

  // Draw the page, then find and box the quote.
  useEffect(() => {
    if (!pdf || !canvas.current) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    void (async () => {
      const p = await pdf.getPage(page)
      if (cancelled) return
      const width = frame.current?.clientWidth ?? 800
      const base = p.getViewport({ scale: 1 })
      const scale = ((width - 24) / base.width) * zoom
      const viewport = p.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const c = canvas.current!
      c.width = Math.floor(viewport.width * ratio)
      c.height = Math.floor(viewport.height * ratio)
      c.style.width = `${Math.floor(viewport.width)}px`
      c.style.height = `${Math.floor(viewport.height)}px`
      const ctx = c.getContext('2d')!
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      task = p.render({ canvasContext: ctx, viewport }) as unknown as { cancel: () => void; promise: Promise<unknown> }
      await task.promise.catch(() => null)
      if (cancelled || !target) {
        setBoxes([])
        setMissed(false)
        return
      }
      const content = await p.getTextContent()
      const items = content.items.filter((i): i is typeof i & { str: string; transform: number[]; width: number; height: number } => 'str' in i)
      const hit = findQuote(
        items.map((i) => i.str),
        target.quote,
        target.value,
      )
      if (!hit) {
        setBoxes([])
        setMissed(true)
        return
      }
      const found: Box[] = []
      for (let k = hit.first; k <= hit.last; k++) {
        const it = items[k]
        const x = it.transform[4]
        const y = it.transform[5]
        const h = it.height || Math.abs(it.transform[3]) || 10
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([x, y, x + it.width, y + h])
        found.push({ left: Math.min(x1, x2) - 2, top: Math.min(y1, y2) - 2, width: Math.abs(x2 - x1) + 4, height: Math.abs(y2 - y1) + 4 })
      }
      setBoxes(found)
      setMissed(false)
      // Bring the first box into view.
      requestAnimationFrame(() => frame.current?.querySelector('[data-hit]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, page, zoom, target])

  const pages = pdf?.numPages ?? 1
  const noPointer = target && (missed || (!isPdf && imageUrl))
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center gap-1 bg-navy px-2 py-1.5 text-white">
        {isPdf && (
          <>
            <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" disabled={page <= 1} onClick={() => setPage((n) => n - 1)} aria-label="Previous page">
              <ChevronLeftIcon />
            </Button>
            <span className="text-xs tabular-nums">
              {page} of {pages}
            </span>
            <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" disabled={page >= pages} onClick={() => setPage((n) => n + 1)} aria-label="Next page">
              <ChevronRightIcon />
            </Button>
          </>
        )}
        <span className="ml-auto" />
        <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.round((z - 0.25) * 100) / 100)} aria-label="Zoom out">
          <MinusIcon />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon-sm" variant="ghost" className="text-white hover:bg-white/10" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.round((z + 0.25) * 100) / 100)} aria-label="Zoom in">
          <PlusIcon />
        </Button>
      </div>
      {noPointer && (
        <p className="bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Couldn't point to it on this page. The AI read: "{target!.quote || String(target!.value ?? '')}"
        </p>
      )}
      <div ref={frame} className="relative min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
        {error && <p className="p-6 text-center text-sm text-destructive">{error}</p>}
        {!error && !pdf && !imageUrl && (
          <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Opening {doc.fileName}…
          </p>
        )}
        {imageUrl && <img src={imageUrl} alt={doc.fileName} className="mx-auto h-auto max-w-none bg-white shadow-sm" style={{ width: `${zoom * 100}%` }} />}
        {pdf && (
          <div className="relative mx-auto w-fit bg-white shadow-sm">
            <canvas ref={canvas} />
            {boxes.map((b, i) => (
              <span key={i} data-hit className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-300/30" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
