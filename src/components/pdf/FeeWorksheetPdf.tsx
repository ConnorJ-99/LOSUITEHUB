import { Document, Page, Text, View } from '@react-pdf/renderer'
import { OFFICIAL_LE_CALLOUT, WORKSHEET_DISCLAIMER, type FeeWorksheet, type WorksheetSection } from '@/lib/documents/feeWorksheet'
import { AmountRow, EhoFooter, FactGrid, Letterhead, pdfStyles, TitleRow, type DocBrand, type PdfStyles } from './blocks'

function Sections({ sections, s }: { sections: WorksheetSection[]; s: PdfStyles }) {
  return sections.map((sec) => (
    <View key={sec.letter}>
      <AmountRow kind="sub" label={`${sec.letter}. ${sec.title}`} amount={sec.total} s={s} />
      {sec.rows.length === 0 ? <AmountRow label="None" amount={null} s={s} /> : sec.rows.map((r, i) => <AmountRow key={i} label={r.label} note={r.note} amount={r.amount} s={s} />)}
    </View>
  ))
}

/** The Fee Worksheet (template fee-worksheet.hbs), one Letter page. Lays out what feeWorksheet() worked out; no math here. */
export function FeeWorksheetPdf({ worksheet: w, brand, scale = 1 }: { worksheet: FeeWorksheet; brand: DocBrand; scale?: number }) {
  const s = pdfStyles(scale)
  return (
    <Document title={`Fee Worksheet ${w.number}`} author={brand.company.legalName} creator="LOSuite">
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="Estimate only · not a Loan Estimate" title="Fee Worksheet" meta={[`Worksheet #${w.number}`, `Prepared ${w.preparedAt}`, ...(w.borrowers ? [`For ${w.borrowers}`] : [])]} s={s} />
        <Text style={s.callout}>{OFFICIAL_LE_CALLOUT}</Text>
        <FactGrid facts={w.facts} s={s} />

        <View style={s.columns}>
          <View style={s.column}>
            <Text style={s.h2}>Loan costs</Text>
            <Sections sections={w.loanCosts} s={s} />
            <AmountRow kind="total" label="D. Total loan costs (A + B + C)" amount={w.totals.D} s={s} />
          </View>
          <View style={s.column}>
            <Text style={s.h2}>Other costs</Text>
            <Sections sections={w.otherCosts} s={s} />
            <AmountRow kind="total" label="I. Total other costs (E + F + G + H)" amount={w.totals.I} s={s} />
          </View>
        </View>

        <View style={s.tintBox} wrap={false}>
          <AmountRow label="J. Total closing costs (D + I)" amount={w.totals.J} bold s={s} />
          {w.totals.lenderCredits > 0 && <AmountRow label="Lender credits" amount={w.totals.lenderCredits} negative s={s} />}
        </View>

        <View style={s.columns} wrap={false}>
          <View style={[s.column, s.box]}>
            <Text style={s.h3}>Estimated monthly payment</Text>
            {w.payment.lines.map((l) => (
              <AmountRow key={l.label} label={l.label} amount={l.amount} s={s} />
            ))}
            <AmountRow kind="total" label="Total monthly payment" amount={w.payment.total} s={s} />
          </View>
          <View style={[s.column, s.box]}>
            <Text style={s.h3}>{w.cash.title}</Text>
            {w.cash.lines.map((l) => (
              <AmountRow key={l.label} label={l.label} amount={l.amount} negative={l.negative} s={s} />
            ))}
            <AmountRow kind="total" label={w.cash.title} amount={w.cash.total} s={s} />
          </View>
        </View>

        <Text style={s.tiny}>{WORKSHEET_DISCLAIMER}</Text>
        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
