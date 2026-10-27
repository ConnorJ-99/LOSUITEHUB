// Reads a PDF's text in the browser (pdfjs-dist; no AI), page by page and
// line by line, for splitting into guideline passages. Scanned PDFs (images
// only) come back with no text.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

interface TextItem {
  str: string
  hasEOL: boolean
  transform: number[]
}

/** Each page's lines of text, in reading order. */
export async function pdfPages(data: ArrayBuffer): Promise<string[][]> {
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise
  const pages: string[][] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const lines: string[] = []
    let line = ''
    let lastY: number | null = null
    for (const raw of content.items) {
      if (!('str' in raw)) continue
      const item = raw as TextItem
      const y = item.transform[5]
      // A new line when the text drops to a new baseline.
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) {
        lines.push(line.trim())
        line = ''
      }
      line += item.str
      lastY = y
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim())
        line = ''
        lastY = null
      }
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines)
    page.cleanup()
  }
  await pdf.destroy()
  return pages
}

/** SHA-256 of a file, as hex (catches the same file uploaded twice). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
