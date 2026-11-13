import { Document, Image, Page, Rect, Svg, Text, View } from '@react-pdf/renderer'
import logo from '@/assets/mps-logo.png'
import { QUOTE_DISCLAIMER, type QuickQuoteDoc } from '@/lib/documents/quickQuote'
import { qrMatrix } from '@/lib/quickquote/qr'
import { COLORS, EhoFooter, pdfStyles, type DocBrand } from './blocks'

const GREEN = '#1E7A55'

/** The booking link as a QR code, drawn square by square. */
function QrCode({ url, size }: { url: string; size: number }) {
  const m = qrMatrix(url)
  const n = m.length + 2
  return (
    <Svg viewBox={`0 0 ${n} ${n}`} width={size} height={size}>
      <Rect x={0} y={0} width={n} height={n} fill="#FFFFFF" />
      {m.flatMap((row, r) => row.map((dark, c) => (dark ? <Rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1.02} height={1.02} fill={COLORS.ink} /> : null)))}
    </Svg>
  )
}

/** The Loan Options Quote on one Letter page. Lays out what quickQuoteDoc() worked out; no math here. */
export function QuickQuotePdf({ doc, brand, photo, scale = 1 }: { doc: QuickQuoteDoc; brand: DocBrand; photo?: string | null; scale?: number }) {
  const s = pdfStyles(scale)
  const z = (n: number) => n * scale
  const { company, lo } = brand
  const colStyle = (i: number) => ({ flex: 1, paddingHorizontal: z(8), ...(i === doc.highlight ? { backgroundColor: '#EEF3FC' } : {}) })
  const smallCaps = { fontSize: z(7.4), color: COLORS.muted, textTransform: 'uppercase' as const, letterSpacing: 0.6, fontFamily: 'Helvetica-Bold' }

  return (
    <Document title={`Loan Options Quote · ${doc.borrowerName}`} author={company.legalName} creator="LOSuite">
      <Page size="LETTER" style={s.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: z(10), borderBottomWidth: 2, borderBottomColor: COLORS.ink, marginBottom: z(14) }}>
          <View>
            <Image src={company.logo ?? logo} style={company.logo ? s.customLogo : s.logo} />
            <Text style={s.sub}>NMLS #{company.nmls ?? '-'} · mps.mortgage</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: z(13), fontFamily: 'Helvetica-Bold' }}>Loan Options Quote</Text>
            <Text style={{ fontSize: z(8), color: COLORS.muted, marginTop: z(3) }}>
              Prepared {doc.preparedOn} · Valid through {doc.validThrough}
            </Text>
          </View>
        </View>

        <Text style={smallCaps}>Prepared for</Text>
        <Text style={{ fontFamily: 'Times-Bold', fontSize: z(20), lineHeight: 1.25, marginTop: z(4), marginBottom: z(9) }}>{doc.borrowerName}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: z(5), marginBottom: z(14) }}>
          {doc.chips.map((c) => (
            <Text key={c} style={{ backgroundColor: COLORS.tint, borderRadius: z(9), paddingVertical: z(3), paddingHorizontal: z(8), fontSize: z(8) }}>
              {c}
            </Text>
          ))}
        </View>

        <View wrap={false}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1.15 }} />
            {doc.columns.map((col, i) => (
              <View key={col.letter} style={[colStyle(i), { backgroundColor: i === doc.highlight ? '#E3ECFB' : COLORS.tint, paddingTop: z(7), paddingBottom: z(6), borderTopLeftRadius: z(4), borderTopRightRadius: z(4) }]}>
                <Text style={[smallCaps, i === doc.highlight ? { color: COLORS.accent } : {}]}>{col.letter}</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(9.6), marginTop: z(2) }}>{col.title}</Text>
                <Text style={{ fontSize: z(7.6), color: COLORS.muted }}>{col.sub}</Text>
                {col.recommended && <Text style={{ fontSize: z(7.4), color: COLORS.accent, fontFamily: 'Helvetica-Bold' }}>Recommended</Text>}
                {col.badges.map((b) => (
                  <Text key={b} style={{ fontSize: z(7.4), fontFamily: 'Helvetica-Bold', color: b === 'Least cash to close' ? GREEN : COLORS.accent }}>
                    {b}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          {doc.rows.map((r) => {
            const payment = r.kind === 'payment'
            const cash = r.kind === 'cash'
            return (
              <View key={r.label} style={{ flexDirection: 'row', borderTopWidth: payment ? 1 : cash ? 1.5 : 1, borderTopColor: cash ? COLORS.ink : COLORS.line }}>
                <Text style={{ flex: 1.15, paddingVertical: z(payment ? 7 : 5), fontSize: z(8.6), color: payment || cash ? COLORS.ink : COLORS.muted, fontFamily: payment || cash ? 'Helvetica-Bold' : 'Helvetica' }}>{r.label}</Text>
                {r.values.map((v, i) => (
                  <Text
                    key={i}
                    style={[
                      colStyle(i),
                      {
                        paddingVertical: z(payment ? 7 : 5),
                        fontSize: z(payment ? 12 : r.label === 'Interest rate' ? 9.6 : 8.6),
                        fontFamily: payment || cash || r.label === 'Interest rate' ? 'Helvetica-Bold' : 'Helvetica',
                        color: payment && i === doc.highlight ? COLORS.accent : COLORS.ink,
                      },
                    ]}
                  >
                    {v}
                  </Text>
                ))}
              </View>
            )
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: z(24), marginTop: z(18) }} wrap={false}>
          <View style={{ flex: 1 }}>
            <Text style={smallCaps}>A note from {doc.loFirstName}</Text>
            <Text style={{ fontSize: z(8.8), lineHeight: 1.5, marginTop: z(5) }}>{doc.note ?? 'Here are your options side by side. Happy to walk through them with you.'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={smallCaps}>Next steps</Text>
            {doc.nextSteps.map((step, i) => (
              <Text key={step} style={{ fontSize: z(8.8), lineHeight: 1.5, marginTop: i === 0 ? z(5) : 0 }}>
                {i + 1}. {step}
              </Text>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: z(10), marginTop: z(18), paddingTop: z(12), borderTopWidth: 1, borderTopColor: COLORS.line }} wrap={false}>
          {photo && <Image src={photo} style={{ width: z(44), height: z(44), borderRadius: z(22), objectFit: 'cover' }} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(10) }}>{lo.name}</Text>
            <Text style={{ fontSize: z(8.2), color: COLORS.muted }}>Loan Officer{lo.nmls ? ` · NMLS #${lo.nmls}` : ''}</Text>
            <Text style={{ fontSize: z(8.2), color: COLORS.muted }}>{[lo.email, lo.phone].filter(Boolean).join(' · ')}</Text>
          </View>
          {doc.bookingUrl && (
            <View style={{ alignItems: 'center' }}>
              <QrCode url={doc.bookingUrl} size={z(58)} />
              <Text style={{ fontSize: z(6.8), color: COLORS.muted, marginTop: z(2) }}>Scan to book a call</Text>
            </View>
          )}
        </View>

        <Text style={[s.tiny, { marginTop: z(12) }]}>{QUOTE_DISCLAIMER}</Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
