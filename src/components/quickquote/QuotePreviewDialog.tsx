import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, FolderInputIcon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Prints the page as a sharp image from a hidden frame (works where a browser has no PDF viewer, like the app's own browser). */
async function printPage(url: string) {
  const { drawFirstPage } = await import('@/lib/documents/pdfText')
  const canvas = document.createElement('canvas')
  // About 200 dots per inch on a Letter page.
  await drawFirstPage(url, canvas, 1700 / (window.devicePixelRatio || 1))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = `<!doctype html><html><head><style>@page{size:letter;margin:0}html,body{margin:0}img{display:block;width:100%}</style></head><body><img src="${canvas.toDataURL('image/png')}"></body></html>`
  document.body.appendChild(frame)
  await new Promise<void>((resolve) => (frame.onload = () => resolve()))
  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  setTimeout(() => frame.remove(), 60_000)
}

/**
 * The quote PDF shown inside the page (drawn on a canvas, so it shows in every
 * browser), with Print, Download and, on a borrower file, Save to Documents.
 */
export function QuotePreviewDialog({ file, fileName, onSaveToFile, onClose }: { file: Blob; fileName: string; onSaveToFile: (() => Promise<void>) | null; onClose: () => void }) {
  // Made and freed in one effect, so a second run of the effect (React's dev check) gets a fresh link.
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [printing, setPrinting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!url) return
    // The dialog's content mounts a moment after it opens.
    const t = setTimeout(() => {
      if (!box.current || !canvas.current) return
      import('@/lib/documents/pdfText').then(({ drawFirstPage }) => drawFirstPage(url, canvas.current!, box.current!.clientWidth)).catch(() => toast.error("The preview couldn't be drawn. Use Download."))
    }, 50)
    return () => clearTimeout(t)
  }, [url])

  const download = () => {
    if (!url) return
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const print = async () => {
    if (!url) return
    setPrinting(true)
    try {
      await printPage(url)
    } catch (e) {
      toast.error(`Printing didn't start: ${(e as Error).message}. Use Download and print the file.`)
    } finally {
      setPrinting(false)
    }
  }

  const saveToFile = async () => {
    if (!onSaveToFile) return
    setSaving(true)
    try {
      await onSaveToFile()
      setSaved(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95svh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview &amp; print</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto rounded-md border bg-muted p-2">
          <div ref={box} className="mx-auto w-full max-w-[680px] bg-white shadow-sm">
            <canvas ref={canvas} aria-label="Quote preview" className="block" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex flex-wrap gap-2">
            {onSaveToFile && (
              <Button type="button" variant="outline" disabled={saving || saved} onClick={saveToFile}>
                <FolderInputIcon />
                {saved ? 'Saved to Documents' : saving ? 'Saving…' : 'Save to Documents'}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={download}>
              <DownloadIcon />
              Download
            </Button>
            <Button type="button" disabled={printing} onClick={print}>
              <PrinterIcon />
              {printing ? 'Getting it ready…' : 'Print'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
