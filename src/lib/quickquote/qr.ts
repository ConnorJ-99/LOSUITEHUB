// The booking-link QR code on the quote, as a grid of dark and light squares
// the PDF draws itself. Pure (qrcode-generator has no dependencies).

import qrcode from 'qrcode-generator'

/** Rows of modules, true = dark. Medium error correction, the smallest size that fits. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => qr.isDark(row, col)))
}
