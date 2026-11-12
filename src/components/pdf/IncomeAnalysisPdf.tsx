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
        {a.sources.length > 0 && (
          <>
            <Text style={s.h2}>Documents used</Text>
            <View style={{ marginBottom: z(8) }}>{list(a.sources, COLORS.muted)}</View>
          </>
        )}

        <Text style={s.tiny}>{a.disclaimer}</Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
