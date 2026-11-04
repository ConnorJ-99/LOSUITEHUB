import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { PrequalResultsView } from '@/lib/documents/prequalResults'
import { AmountRow, COLORS, EhoFooter, FactGrid, Letterhead, pdfStyles, TitleRow, type DocBrand } from './blocks'

/** Prequal results, one Letter page. Lays out what prequalResultsView() worked out; no math here. */
export function PrequalResultsPdf({ results: r, brand, scale = 1 }: { results: PrequalResultsView; brand: DocBrand; scale?: number }) {
  const s = pdfStyles(scale)
  const z = (n: number) => n * scale
  const { lo } = brand
  return (
    <Document title={`Prequalification Results - ${r.borrowers}`} author={brand.company.legalName} creator="MPS HQ">
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="You're pre-qualified" title="Prequalification Results" meta={[r.borrowers, `Prepared ${r.preparedOn}`]} s={s} />

        <View style={[s.box, { borderColor: COLORS.accent, borderWidth: 1.5, paddingVertical: z(10), marginBottom: z(12) }]}>
          <Text style={s.eyebrow}>{r.headline.label}</Text>
          <Text style={{ fontSize: z(24), lineHeight: 1.2, color: COLORS.navy, fontFamily: 'Helvetica-Bold' }}>{r.headline.value}</Text>
          <Text style={s.note}>{r.headline.note}</Text>
        </View>

        <Text style={s.h2}>Your loan</Text>
        <FactGrid facts={r.facts} s={s} />

        <View style={s.columns}>
          <View style={s.column}>
            <Text style={s.h2}>Estimated monthly payment</Text>
            {r.payment.map((l) => (
              <AmountRow key={l.label} label={l.label} amount={l.amount} s={s} />
            ))}
            <AmountRow label="Total monthly payment" amount={r.paymentTotal} kind="total" s={s} />
          </View>
          {r.cash.length > 0 && (
            <View style={s.column}>
              <Text style={s.h2}>Estimated cash needed</Text>
              {r.cash.map((l) => (
                <AmountRow key={l.label} label={l.label} amount={l.amount} s={s} />
              ))}
              <AmountRow label="Total cash needed" amount={r.cashTotal} kind="total" s={s} />
            </View>
          )}
        </View>

        <Text style={[s.h2, { marginTop: z(14) }]}>Next steps</Text>
        <View style={{ marginBottom: z(8) }}>
          {r.nextSteps.map((step, i) => (
            <View key={step} style={{ flexDirection: 'row', marginBottom: z(3.5) }}>
              <Text style={{ width: z(14), fontFamily: 'Helvetica-Bold', color: COLORS.accent }}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>{step}</Text>
            </View>
          ))}
        </View>
        {(lo.phone || lo.email) && <Text style={{ marginBottom: z(6) }}>Questions? Contact me at {[lo.phone, lo.email].filter(Boolean).join(' or ')}.</Text>}

        <Text style={s.tiny}>{r.disclaimer}</Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
