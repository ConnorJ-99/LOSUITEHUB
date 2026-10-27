import { Document, Page, Text, View } from '@react-pdf/renderer'
import { OFFICIAL_LE_CALLOUT } from '@/lib/documents/feeWorksheet'
import type { LoanComparison } from '@/lib/documents/loanComparison'
import { COLORS, EhoFooter, FactGrid, Letterhead, pdfStyles, TitleRow, type DocBrand } from './blocks'

const DISCLAIMER =
  'These options are for illustration and information only, based on the information provided and lender pricing on the preparation date. They are not a Loan Estimate, loan approval or commitment to lend, and rates, points and costs can change until your rate is locked. Taxes, insurance and HOA are estimates. You will receive an official Loan Estimate after you apply.'

/** Loan options side by side for the borrower, one Letter page. Lays out what loanComparison() worked out; no math here. */
export function LoanComparisonPdf({ comparison: c, brand, scale = 1 }: { comparison: LoanComparison; brand: DocBrand; scale?: number }) {
  const s = pdfStyles(scale)
  const z = (n: number) => n * scale
  const cell = { flex: 1, textAlign: 'right' as const, paddingLeft: z(6) }
  return (
    <Document title={`Loan options ${c.number}`} author={brand.company.legalName} creator="LOSuite">
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="Estimate only · not a Loan Estimate" title="Your Loan Options" meta={[`Comparison #${c.number}`, `Prepared ${c.preparedAt}`, ...(c.borrowers ? [`For ${c.borrowers}`] : [])]} s={s} />
        <Text style={s.callout}>{OFFICIAL_LE_CALLOUT}</Text>
        <FactGrid facts={c.facts} s={s} />

        <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 5 }} wrap={false}>
          <View style={{ flexDirection: 'row', backgroundColor: COLORS.tint, paddingVertical: z(6), paddingHorizontal: z(8) }}>
            <Text style={{ flex: 1.3 }} />
            {c.columns.map((col) => (
              <View key={col.name} style={cell}>
                <Text style={{ fontFamily: 'Helvetica-Bold', color: COLORS.navy, fontSize: z(10) }}>{col.name}</Text>
                <Text style={{ fontSize: z(7.4), color: COLORS.muted }}>{col.program}</Text>
                {col.best.map((b) => (
                  <Text key={b} style={{ fontSize: z(7), color: COLORS.accent, fontFamily: 'Helvetica-Bold' }}>
                    {b}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          {c.rows.map((r, i) => (
            <View key={r.label} style={{ flexDirection: 'row', paddingVertical: z(3.5), paddingHorizontal: z(8), borderTopWidth: i === 0 ? 0 : 1, borderTopColor: COLORS.line, fontSize: z(8.6), fontFamily: r.strong ? 'Helvetica-Bold' : 'Helvetica' }}>
              <Text style={{ flex: 1.3, color: r.strong ? COLORS.ink : COLORS.muted }}>{r.label}</Text>
              {r.values.map((v, j) => (
                <Text key={j} style={cell}>
                  {v}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <Text style={[s.tiny, { marginTop: z(8) }]}>
          Cost over {c.horizonYears} years = cash to close plus {c.horizonYears} years of principal, interest and mortgage insurance. Estimated monthly payment includes estimated property taxes, homeowner&apos;s insurance and HOA dues. {DISCLAIMER}
        </Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
