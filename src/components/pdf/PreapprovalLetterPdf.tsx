import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { LetterView } from '@/lib/documents/preapproval'
import { COLORS, EhoFooter, FactGrid, Letterhead, pdfStyles, TitleRow, type DocBrand } from './blocks'

/** The pre-approval letter (template preapproval-letter.hbs), one Letter page. Lays out what letterView() worked out; no math here. */
export function PreapprovalLetterPdf({ letter: l, brand, scale = 1 }: { letter: LetterView; brand: DocBrand; scale?: number }) {
  const s = pdfStyles(scale)
  const z = (n: number) => n * scale
  const p = { marginBottom: z(7) }
  const bullet = (text: string, i: number) => (
    <View key={i} style={{ flexDirection: 'row', marginBottom: z(2.5), paddingLeft: z(6) }}>
      <Text style={{ width: z(10) }}>•</Text>
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
  )
  const { company, lo } = brand
  return (
    <Document title={`Pre-Approval Letter ${l.referenceNumber} v${l.version}`} author={company.legalName} creator="LOSuite">
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="Mortgage pre-approval" title="Pre-Approval Letter" meta={[`Reference #${l.referenceNumber} · v${l.version}`, `Issued ${l.issuedOn}`, `Expires ${l.expiresOn}`]} s={s} />

        <View style={{ flexDirection: 'row', marginBottom: z(3) }}>
          <Text style={{ width: z(70), color: COLORS.muted }}>Borrower(s)</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold', flex: 1 }}>{l.borrowers}</Text>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: z(10) }}>
          <Text style={{ width: z(70), color: COLORS.muted }}>Property</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold', flex: 1 }}>{l.property}</Text>
        </View>

        <Text style={p}>{l.greeting},</Text>
        <Text style={p}>
          Congratulations. Based on the information and documentation you provided to {company.legalName} about your income, employment, assets and credit, you are pre-approved for a home loan on the terms below.
        </Text>

        <Text style={s.h2}>Pre-approval terms</Text>
        <FactGrid facts={l.terms} s={s} />

        {l.reviewed.length > 0 && (
          <View>
            <Text style={s.h2}>What we have reviewed</Text>
            <View style={{ marginBottom: z(6) }}>{l.reviewed.map(bullet)}</View>
          </View>
        )}

        <Text style={s.h2}>Conditions</Text>
        <Text style={{ marginBottom: z(3) }}>This pre-approval is subject to:</Text>
        <View style={{ marginBottom: z(7) }}>{l.conditions.map(bullet)}</View>

        <Text style={p}>This letter is not a commitment to lend. A loan commitment requires complete underwriting approval. Interest rates and programs are subject to change until your rate is locked.</Text>
        {(lo.phone || lo.email) && <Text style={p}>Questions? Contact me at {[lo.phone, lo.email].filter(Boolean).join(' or ')}.</Text>}

        <View wrap={false} style={{ marginTop: z(4) }}>
          <Text>Sincerely,</Text>
          <View style={{ height: z(30) }} />
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{lo.name}</Text>
          <Text style={{ fontSize: z(8), color: COLORS.muted }}>
            Loan Officer · NMLS #{lo.nmls ?? '—'} · {company.legalName}, NMLS #{company.nmls ?? '—'}
          </Text>
        </View>

        <EhoFooter brand={brand} s={s} />
      </Page>
    </Document>
  )
}
