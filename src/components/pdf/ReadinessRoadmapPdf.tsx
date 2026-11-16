import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { RoadmapView } from '@/lib/documents/readinessRoadmap'
import { COLORS, EhoFooter, Letterhead, pdfStyles, TitleRow, type DocBrand } from './blocks'

const LIGHT_BLUE = '#E6EEFB'

/**
 * "Your Roadmap to Homeownership" (Connor, 2026-11-16): 3–5 Letter pages,
 * navy / light blue / white. Lays out what roadmapView() worked out from the
 * approved plan; nothing is worked out here. Unlike the one-page documents,
 * long sections flow onto the next page.
 */
export function ReadinessRoadmapPdf({ roadmap: r, brand }: { roadmap: RoadmapView; brand: DocBrand }) {
  const s = pdfStyles(1)
  const footer = (
    <View fixed style={{ position: 'absolute', bottom: 18, left: 43, right: 43, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: COLORS.muted }}>
      <Text>Your Roadmap to Homeownership · {r.borrower}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
  const section = (title: string) => (
    <View style={{ backgroundColor: COLORS.navy, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 4, marginBottom: 8, marginTop: 4 }} wrap={false}>
      <Text style={{ color: 'white', fontFamily: 'Helvetica-Bold', fontSize: 10.5, letterSpacing: 0.4 }}>{title}</Text>
    </View>
  )
  return (
    <Document title={`Your Roadmap to Homeownership - ${r.borrower}`} author={brand.company.legalName} creator="MPS HQ">
      {/* 1. Personal overview and 2. current readiness */}
      <Page size="LETTER" style={s.page}>
        <Letterhead brand={brand} s={s} />
        <TitleRow eyebrow="Buyer Readiness Plan" title="Your Roadmap to Homeownership" meta={[r.borrower, `Prepared ${r.preparedOn}`, `Version ${r.version}`]} s={s} />
        <View style={{ backgroundColor: LIGHT_BLUE, borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <Text style={{ fontSize: 8, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your goal</Text>
          <Text style={{ fontSize: 16, color: COLORS.navy, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>{r.goal}</Text>
          <Text style={{ color: COLORS.ink }}>Planning time frame: {r.timeframe}</Text>
          <Text style={{ color: COLORS.ink }}>Your loan officer: {r.contact}</Text>
        </View>
        <Text style={{ fontSize: 10, marginBottom: 14 }}>{r.intro}</Text>
        {section('Where you are today')}
        <Text style={{ marginBottom: 8 }}>These are the things we agreed to work on before you buy:</Text>
        {r.readiness.map((g) => (
          <View key={g.group} style={{ flexDirection: 'row', marginBottom: 6 }} wrap={false}>
            <Text style={{ width: 130, fontFamily: 'Helvetica-Bold', color: COLORS.navy }}>{g.group}</Text>
            <View style={{ flex: 1 }}>
              {g.items.map((x) => (
                <Text key={x}>• {x}</Text>
              ))}
            </View>
          </View>
        ))}
        {footer}
      </Page>

      {/* 3. The step-by-step action plan */}
      <Page size="LETTER" style={s.page}>
        {section('Your step-by-step plan')}
        {r.actions.map((a) => (
          <View key={a.n} style={{ borderWidth: 1, borderColor: COLORS.line, borderLeftWidth: 3, borderLeftColor: COLORS.accent, borderRadius: 5, padding: 9, marginBottom: 9 }} wrap={false}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.navy, marginBottom: 2 }}>
              {a.n}. {a.title}
            </Text>
            {a.why ? <Text style={{ marginBottom: 4 }}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Why it matters: </Text>{a.why}</Text> : null}
            {a.steps.length > 0 && <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 1 }}>What to do</Text>}
            {a.steps.map((st) => (
              <Text key={st} style={{ marginLeft: 8 }}>• {st}</Text>
            ))}
            {a.check.length > 0 && (
              <View style={{ backgroundColor: LIGHT_BLUE, borderRadius: 4, padding: 6, marginTop: 5 }}>
                <Text style={{ fontFamily: 'Helvetica-Bold', color: COLORS.navy, marginBottom: 1 }}>How we’ll check progress</Text>
                {a.check.map((c) => (
                  <Text key={c}>• {c}</Text>
                ))}
              </View>
            )}
          </View>
        ))}
        {footer}
      </Page>

      {/* 4. Timeline and milestones */}
      <Page size="LETTER" style={s.page}>
        {section('Your timeline')}
        {r.timeline.map((t, i) => (
          <View key={`${t.title}-${i}`} style={{ flexDirection: 'row', marginBottom: 7 }} wrap={false}>
            <View style={{ width: 92 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', color: COLORS.navy }}>{t.date}</Text>
            </View>
            <View style={{ width: 12, alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 3, backgroundColor: t.done ? COLORS.accent : 'white', borderWidth: 1.5, borderColor: COLORS.accent }} />
            </View>
            <View style={{ flex: 1, paddingLeft: 6 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                {t.title}
                {t.done ? '  (done)' : ''}
              </Text>
              {t.measure ? <Text style={{ color: COLORS.muted }}>{t.measure}</Text> : null}
            </View>
          </View>
        ))}
        {r.reviewOn && (
          <View style={{ backgroundColor: LIGHT_BLUE, borderRadius: 5, padding: 9, marginTop: 8 }} wrap={false}>
            <Text style={{ fontFamily: 'Helvetica-Bold', color: COLORS.navy }}>Next review together: {r.reviewOn}</Text>
          </View>
        )}
        {footer}
      </Page>

      {/* 5. Next steps, contact and the disclosure */}
      <Page size="LETTER" style={s.page}>
        {section('Next steps')}
        {r.outstanding.length > 0 && (
          <>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Still to do</Text>
            {r.outstanding.map((o) => (
              <Text key={o} style={{ marginLeft: 8 }}>• {o}</Text>
            ))}
          </>
        )}
        {r.reviewOn && <Text style={{ marginTop: 8 }}>Next review date: {r.reviewOn}</Text>}
        <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 2 }}>How to send updates</Text>
        <Text>{r.howToUpdate}</Text>
        <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 2 }}>When we reassess</Text>
        <Text>{r.reassessment}</Text>
        <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 2 }}>Your loan officer</Text>
        <Text>{r.contact}</Text>
        <View style={{ borderWidth: 1, borderColor: COLORS.line, borderRadius: 5, padding: 8, marginTop: 16 }} wrap={false}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8, marginBottom: 2 }}>Important</Text>
          <Text style={s.tiny}>{r.disclosure}</Text>
        </View>
        <EhoFooter brand={brand} s={s} />
        {footer}
      </Page>
    </Document>
  )
}
