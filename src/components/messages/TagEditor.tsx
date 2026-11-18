import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import { tagInfo, tagPieces, tagText, type TagKey } from '@/lib/messaging/mergeTags'

// The message box with merge tags drawn as chips ("LO · Application link")
// instead of raw braces (LO Assistant step 3, Connor 2026-11-17). The value is
// plain text with {{tags}}; a chip can't be typed inside, only deleted whole.

const CHIP = 'mx-0.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-px align-baseline text-xs font-medium text-primary'
const BAD_CHIP = 'mx-0.5 inline-flex items-center rounded bg-destructive/10 px-1.5 py-px align-baseline text-xs font-medium text-destructive'

function chipNode(key: string): HTMLElement {
  const span = document.createElement('span')
  span.contentEditable = 'false'
  span.dataset.tag = key
  const info = tagInfo(key)
  span.className = info ? CHIP : BAD_CHIP
  span.textContent = info?.label ?? `{{${key}}}`
  return span
}

function buildNodes(value: string): Node[] {
  const nodes: Node[] = []
  for (const piece of tagPieces(value)) {
    if ('tag' in piece) {
      nodes.push(chipNode(piece.tag))
      continue
    }
    piece.text.split('\n').forEach((line, i) => {
      if (i > 0) nodes.push(document.createElement('br'))
      if (line) nodes.push(document.createTextNode(line))
    })
  }
  return nodes
}

function serialize(root: Node): string {
  let out = ''
  root.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) out += (n.nodeValue ?? '').replace(/ /g, ' ')
    else if (n instanceof HTMLElement) {
      if (n.dataset.tag) out += tagText(n.dataset.tag as TagKey)
      else if (n.tagName === 'BR') out += '\n'
      else if (n.tagName === 'DIV' || n.tagName === 'P') out += (i > 0 ? '\n' : '') + serialize(n)
      else out += serialize(n)
    }
  })
  return out
}

export interface TagEditorHandle {
  /** Puts a chip where the cursor was (else at the end). */
  insertTag: (key: TagKey) => void
}

export const TagEditor = forwardRef<TagEditorHandle, { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label: string }>(function TagEditor(
  { value, onChange, placeholder, rows = 3, label },
  ref,
) {
  const el = useRef<HTMLDivElement>(null)
  const last = useRef<string | null>(null)
  const range = useRef<Range | null>(null)
  const redrawToEnd = useRef(false)
  const [focused, setFocused] = useState(false)

  // Only redraw when the value changed from outside (a template, Send clearing it), so the cursor stays put while typing.
  useLayoutEffect(() => {
    if (!el.current || value === last.current) return
    el.current.replaceChildren(...buildNodes(value))
    last.current = value
    if (redrawToEnd.current) {
      redrawToEnd.current = false
      const end = document.createRange()
      end.selectNodeContents(el.current)
      end.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(end)
    }
  }, [value])

  const read = () => {
    if (!el.current) return
    const v = serialize(el.current)
    last.current = v
    onChange(v)
  }
  const remember = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && el.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange()
  }

  useImperativeHandle(ref, () => ({
    insertTag: (key) => {
      const box = el.current
      if (!box) return
      const chip = chipNode(key)
      const space = document.createTextNode(' ')
      const r = range.current && box.contains(range.current.startContainer) ? range.current : null
      if (r) {
        r.deleteContents()
        r.insertNode(space)
        r.insertNode(chip)
      } else {
        box.append(chip, space)
      }
      const after = document.createRange()
      after.setStartAfter(space)
      after.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(after)
      range.current = after.cloneRange()
      box.focus()
      read()
    },
  }))

  return (
    <div className="relative">
      <div
        ref={el}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        onInput={read}
        onKeyUp={remember}
        onMouseUp={remember}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          remember()
          setFocused(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            // One line break, never a new <div>.
            e.preventDefault()
            document.execCommand('insertLineBreak')
            read()
          }
        }}
        onPaste={(e) => {
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          if (!el.current) return
          // Pasted {{tags}} become chips: redraw, with the cursor at the end.
          const v = serialize(el.current)
          last.current = null
          redrawToEnd.current = true
          onChange(v)
        }}
        style={{ minHeight: `${rows * 1.5 + 1}rem` }}
        className={cn('w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap shadow-xs outline-none', focused && 'border-ring ring-[3px] ring-ring/50')}
      />
      {!value && placeholder && <span className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">{placeholder}</span>}
    </div>
  )
})

/** A message with its tags as chips, read only (the template picker's preview). */
export function TagText({ text }: { text: string }) {
  return (
    <>
      {tagPieces(text).map((p, i) =>
        'tag' in p ? (
          <span key={i} className={tagInfo(p.tag) ? CHIP : BAD_CHIP}>
            {tagInfo(p.tag)?.label ?? `{{${p.tag}}}`}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
