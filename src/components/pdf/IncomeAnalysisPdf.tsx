import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { IncomeAnalysisView } from '@/lib/documents/incomeAnalysis'
import { AmountRow, COLORS, EhoFooter, FactGrid, Letterhead, pdfStyles, TitleRow, type DocBrand } from './blocks'

/** The Income Analysis, one Letter page. Lays out what incomeAnalysisView() worked out; no math here. */
export function IncomeAnalysisPdf({ analysis: a, brand, scale = 1 }: { analysis: IncomeAnalysisView; brand: DocBrand; scale?: number }) {
  const s = pdfStyles(scale)
  const z = (n: number) => n * scale
  const list = (items: string[], color: string = COLORS.ink) =>
    items.map((t) => (
      <View key={t} style={{ flexDirection: 'row', marginBottom: z(2.5) }}>
        <Text style={{ width: z(10), color }}>•</Text>
        <Text style={{ flex: 1, color }}>{t}</Text>
      </View>
    ))
  return (
    <Document title={`${a.title} - ${a.borrower}`} author={brand.company.legalName} creator="MPS HQ">
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="For underwriting review" title={a.title} meta={[a.borrower, `Prepared ${a.preparedOn}`]} s={s} />
        <FactGrid facts={a.facts} s={s} />

        <Text style={[s.h2, { marginTop: z(6) }]}>The calculation</Text>
        <View style={{ marginBottom: z(10) }}>
          {a.lines.map((l, i) => (
            <AmountRow key={`${l.label}-${i}`} label={l.label} amount={l.amount} negative={l.negative} kind={l.kind} s={s} />
          ))}
        </View>

        {a.warnings.length > 0 && (
          <>
            <Text style={s.h2}>Flags</Text>
            <View style={{ marginBottom: z(8) }}>{list(a.warnings, '#9A3412')}</View>
          </>
        )}
        {a.notes.length > 0 && (
          <>
            <Text style={s.h2}>How it was worked out</Text>
            <View style={{ marginBottom: z(8) }}>{list(a.notes)}</View>
          </>
        )}
        {a.figureSources.length > 0 ? (
          <>
            <Text style={s.h2}>Sources</Text>
            <View style={{ marginBottom: z(8) }}>
              <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderColor: COLORS.muted, paddingBottom: z(2), marginBottom: z(2) }}>
                <Text style={{ flex: 2.2, color: COLORS.muted }}>Figure</Text>
                <Text style={{ flex: 2, color: COLORS.muted }}>Document</Text>
                <Text style={{ width: z(26), color: COLORS.muted }}>Page</Text>
                {a.showQuotes && <Text style={{ flex: 3, color: COLORS.muted }}>Read from</Text>}
              </View>
              {a.figureSources.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', marginBottom: z(1.5) }}>
                  <Text style={{ flex: 2.2 }}>{f.figure}</Text>
                  <Text style={{ flex: 2, color: COLORS.muted }}>{f.document}</Text>
                  <Text style={{ width: z(26), color: COLORS.muted }}>{f.page}</Text>
                  {a.showQuotes && <Text style={{ flex: 3, color: COLORS.muted }}>"{f.quote}"</Text>}
                </View>
              ))}
            </View>
          </>
        ) : (
          a.sources.length > 0 && (
            <>
              <Text style={s.h2}>Documents used</Text>
              <View style={{ marginBottom: z(8) }}>{list(a.sources, COLORS.muted)}</View>
            </>
          )
        )}
        {a.changes.length > 0 && (
          <>
            <Text style={s.h2}>Changed by the loan officer</Text>
            <View style={{ marginBottom: z(8) }}>{list(a.changes)}</View>
          </>
        )}
        {a.reviewed && <Text style={{ marginBottom: z(6), fontWeight: 700 }}>{a.reviewed}</Text>}

        <Text style={s.tiny}>{a.disclaimer}</Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
