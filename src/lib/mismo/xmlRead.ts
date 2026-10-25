// A small, dependency-free XML reader for MISMO files. Handles elements,
// attributes, text, CDATA, comments, processing instructions and entities.
// Namespace prefixes are kept on `name` and stripped on `local`.

export interface XElement {
  /** Tag name as written, e.g. "ULAD:HMDAGenderType". */
  name: string
  /** Tag name without a namespace prefix, e.g. "HMDAGenderType". */
  local: string
  attrs: Record<string, string>
  children: XElement[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? whole
  })
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1)

export class XmlParseError extends Error {}

/** Parses an XML document and returns its root element. Throws XmlParseError on malformed input. */
export function parseXml(source: string): XElement {
  const xml = source.replace(/^﻿/, '')
  const stack: XElement[] = []
  let root: XElement | null = null
  let i = 0

  const appendText = (raw: string) => {
    if (stack.length) stack[stack.length - 1].text += raw
  }

  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) {
      appendText(decode(xml.slice(i)))
      break
    }
    if (lt > i) appendText(decode(xml.slice(i, lt)))

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      if (end === -1) throw new XmlParseError('Unclosed comment')
      i = end + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      if (end === -1) throw new XmlParseError('Unclosed CDATA section')
      appendText(xml.slice(lt + 9, end))
      i = end + 3
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2)
      if (end === -1) throw new XmlParseError('Unclosed processing instruction')
      i = end + 2
    } else if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2)
      if (end === -1) throw new XmlParseError('Unclosed declaration')
      i = end + 1
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt + 2)
      if (end === -1) throw new XmlParseError('Unclosed end tag')
      const name = xml.slice(lt + 2, end).trim()
      const open = stack.pop()
      if (!open || open.name !== name) throw new XmlParseError(`Mismatched end tag </${name}>`)
      i = end + 1
    } else {
      // Start tag: find the closing '>' outside quoted attribute values.
      let j = lt + 1
      let quote: string | null = null
      while (j < xml.length) {
        const c = xml[j]
        if (quote) {
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
        j++
      }
      if (j >= xml.length) throw new XmlParseError('Unclosed start tag')
      let body = xml.slice(lt + 1, j)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const nameMatch = /^\s*([^\s/>]+)/.exec(body)
      if (!nameMatch) throw new XmlParseError('Missing tag name')
      const name = nameMatch[1]
      const attrs: Record<string, string> = {}
      for (const m of body.slice(nameMatch[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        attrs[m[1]] = decode(m[3] ?? m[4] ?? '')
      }
      const element: XElement = { name, local: localName(name), attrs, children: [], text: '' }
      if (stack.length) stack[stack.length - 1].children.push(element)
      else if (!root) root = element
      else throw new XmlParseError('More than one root element')
      if (!selfClosing) stack.push(element)
      i = j + 1
    }
  }

  if (stack.length) throw new XmlParseError(`Unclosed element <${stack[stack.length - 1].name}>`)
  if (!root) throw new XmlParseError('No root element')
  return root
}

// ---------------------------------------------------------------------------
// Navigation helpers (by local name, ignoring namespace prefixes)
// ---------------------------------------------------------------------------

/** Direct children with a local name. */
export const kids = (e: XElement | null | undefined, local: string): XElement[] => (e ? e.children.filter((c) => c.local === local) : [])

/** First direct child with a local name. */
export const kid = (e: XElement | null | undefined, local: string): XElement | null => kids(e, local)[0] ?? null

/** Follow a path of local names, returning every match. e.g. path(deal, 'ASSETS', 'ASSET'). */
export function path(e: XElement | null | undefined, ...locals: string[]): XElement[] {
  let level: XElement[] = e ? [e] : []
  for (const l of locals) level = level.flatMap((x) => kids(x, l))
  return level
}

/** Text of the first element along a path, trimmed, or null when missing/empty. */
export function textAt(e: XElement | null | undefined, ...locals: string[]): string | null {
  const found = path(e, ...locals)[0]
  const t = found?.text.trim()
  return t ? t : null
}

/** Every descendant with a local name (depth-first). */
export function descendants(e: XElement | null | undefined, local: string): XElement[] {
  if (!e) return []
  const out: XElement[] = []
  const walk = (x: XElement) => {
    for (const c of x.children) {
      if (c.local === local) out.push(c)
      walk(c)
    }
  }
  walk(e)
  return out
}

/** Attribute by local name (so "xlink:label" matches "label"). */
export function attr(e: XElement | null | undefined, local: string): string | null {
  if (!e) return null
  for (const [k, v] of Object.entries(e.attrs)) if (localName(k) === local) return v.trim()
  return null
}
