// Reading and writing CSV files (RFC 4180): commas, quoted fields with
// commas, quotes and line breaks inside, Windows or Unix line endings, and
// the byte-order mark Excel adds. Pure, so the import screen and the tests
// share it.

/** Every row of the file as text cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const endRow = () => {
    row.push(cell)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
    cell = ''
  }

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++
      endRow()
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value
}

/** Rows of cells to CSV text, with Windows line endings so Excel opens it cleanly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => quote(c === null || c === undefined ? '' : String(c))).join(',')).join('\r\n') + '\r\n'
}
