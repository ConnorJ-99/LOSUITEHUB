import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { SummaryView } from '@/lib/documents/borrowerSummary'
import type { DocBrand } from './blocks'

const NAVY = '#14233A'
const INK = '#1B2430'
const MUTED = '#5B6676'
const LINE = '#D5DBE3'
const TINT = '#EEF2F6'

/**
 * The Borrower Summary (Connor, 2026-11-24), laid out like his sample: a navy
 * bar, the name, four tiles, numbered sections, and a confidential footer with
 * the company NMLS, date and page number on every page. Long summaries flow on
 * to a second page. Everything shown is worked out in borrowerSummaryView().
 */
export function BorrowerSummaryPdf({ summary: v, brand }: { summary: SummaryView; brand: DocBrand }) {
  const h2 = { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 12, marginBottom: 5 }
  return (
    <Document title={v.title} author={brand.company.legalName} creator="MPS HQ">
      <Page size="LETTER" style={{ paddingTop: 70, paddingBottom: 50, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 9, lineHeight: 1.4, color: INK }}>
        <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 48, backgroundColor: NAVY, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 40 }}>
          <Text style={{ color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 14 }}>MPS HQ</Text>
          <Text style={{ color: 'white', fontSize: 8.5, letterSpacing: 0.3 }}>MPS MORTGAGE  /  INTERNAL LOAN SUMMARY</Text>
        </View>

        <Text style={{ fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>{v.eyebrow}</Text>
        <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', color: NAVY, lineHeight: 1.15, marginTop: 4 }}>{v.name}</Text>
        <Text style={{ fontSize: 7.5, color: MUTED, marginBottom: 10 }}>{v.subline}</Text>

        <View style={{ flexDirection: 'row', backgroundColor: TINT, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 4 }}>
          {v.tiles.map((t) => (
            <View key={t.label} style={{ flex: 1 }}>
              <Text style={{ fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3 }}>{t.label}</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 2 }}>{t.value}</Text>
            </View>
          ))}
        </View>

        {v.sections.map((s) => (
          <View key={s.title}>
            <Text style={h2} minPresenceAhead={40}>
              {s.title}
            </Text>
            {s.kind === 'text' && <Text>{s.text}</Text>}
            {s.kind === 'rows' &&
              s.rows.map((r) => (
                <View key={r.label} wrap={false} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 }}>
                  <Text style={{ width: 160, fontFamily: 'Helvetica-Bold' }}>{r.label}</Text>
                  <Text style={{ flex: 1 }}>{r.text}</Text>
                </View>
              ))}
            {s.kind === 'table' && (
              <View>
                <View style={{ flexDirection: 'row', backgroundColor: TINT, borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 6 }}>
                  {s.head.map((h) => (
                    <Text key={h} style={{ flex: 1, fontFamily: 'Helvetica-Bold' }}>
                      {h}
                    </Text>
                  ))}
                </View>
                {s.rows.map((row, i) => (
                  <View key={i} wrap={false} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 6 }}>
                    {row.map((c, j) => (
                      <Text key={j} style={{ flex: 1 }}>
                        {c}
                      </Text>
                    ))}
                  </View>
                ))}
                {s.note ? <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 2 }}>{s.note}</Text> : null}
              </View>
            )}
            {s.kind === 'assessment' && (
              <View>
                {s.strengths ? (
                  <Text>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>Strengths: </Text>
                    {s.strengths}
                  </Text>
                ) : null}
                {s.review ? (
                  <Text>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>Review: </Text>
                    {s.review}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        ))}

        <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 12 }}>{v.disclaimer}</Text>

        <View fixed style={{ position: 'absolute', bottom: 22, left: 40, right: 40, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: MUTED }}>
          <Text>
            CONFIDENTIAL • INTERNAL USE ONLY  |  {brand.company.legalName}
            {brand.company.nmls ? ` · NMLS #${brand.company.nmls}` : ''}
          </Text>
          <Text render={({ pageNumber }) => `${v.preparedOn}  |  ${pageNumber}`} />
        </View>
      </Page>
    </Document>
  )
}
