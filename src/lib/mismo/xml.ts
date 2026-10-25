// Minimal XML writer for MISMO files. Pure functions, no browser APIs, so it
// runs in unit tests and in the app the same way.

export type XValue = string | number | boolean | null | undefined
export type XChild = XNode | null | undefined | false

export interface XNode {
  name: string
  attrs?: Record<string, XValue>
  /** Child elements, or a text value for a leaf element. */
  children?: XChild[]
  text?: XValue
  /**
   * Keep children in the order given instead of MISMO's alphabetical order
   * (used for the root's namespace declarations, never for MISMO containers).
   */
  keepOrder?: boolean
  /** Keep this element even with no value or children (e.g. RELATIONSHIP, which is all attributes). */
  keepEmpty?: boolean
}

/** A container element. Missing (null/false) children are skipped. */
export const el = (name: string, children: XChild[] = [], attrs?: Record<string, XValue>): XNode => ({ name, children, attrs })

/** A leaf element with a value. Empty values (null, undefined, '') are left out of the file. */
export const leaf = (name: string, value: XValue): XNode | null =>
  value === null || value === undefined || value === '' ? null : { name, text: value }

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/** MISMO numbers: plain digits and a decimal point, at most 2 decimals for money (no commas, no $). */
function formatValue(value: Exclude<XValue, null | undefined>): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
  return value
}

/**
 * MISMO v3 schemas list child elements alphabetically, ignoring case, with
 * EXTENSION in its alphabetical place. Repeated elements keep their order.
 */
export function mismoOrder(a: string, b: string): number {
  const x = a.replace(/^[A-Za-z]+:/, '').toLowerCase()
  const y = b.replace(/^[A-Za-z]+:/, '').toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

const isNode = (c: XChild): c is XNode => !!c

/** True when an element has no value and no non-empty children (so it's left out). */
function isEmpty(node: XNode): boolean {
  if (node.keepEmpty) return false
  if (node.text !== undefined && node.text !== null && node.text !== '') return false
  return !(node.children ?? []).filter(isNode).some((c) => !isEmpty(c))
}

function renderAttrs(attrs: Record<string, XValue> | undefined): string {
  if (!attrs) return ''
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${escapeXml(formatValue(v as Exclude<XValue, null | undefined>))}"`)
    .join('')
}

function render(node: XNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth)
  const open = `${node.name}${renderAttrs(node.attrs)}`
  if (node.text !== undefined && node.text !== null && node.text !== '') {
    out.push(`${pad}<${open}>${escapeXml(formatValue(node.text))}</${node.name}>`)
    return
  }
  const kids = (node.children ?? []).filter(isNode).filter((c) => !isEmpty(c))
  const ordered = node.keepOrder ? kids : [...kids].sort((a, b) => mismoOrder(a.name, b.name))
  if (ordered.length === 0) {
    out.push(`${pad}<${open}/>`)
    return
  }
  out.push(`${pad}<${open}>`)
  for (const child of ordered) render(child, depth + 1, out)
  out.push(`${pad}</${node.name}>`)
}

/** The whole document as a string, with the XML declaration. */
export function serialize(root: XNode): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>']
  render(root, 0, out)
  return out.join('\n') + '\n'
}
