// The open house flyer PDF (Pages Phase 2b; mockup "Open house flyer · Letter
// PDF"): a locked one-page Letter layout in the MPS document colors. Every
// word comes from flyerView (src/lib/documents/openHouseFlyer.ts).
import { Document, Image, Page, Rect, Svg, Text, View } from '@react-pdf/renderer'
import logo from '@/assets/mps-logo.png'
import { qrMatrix } from '@/lib/quickquote/qr'
import type { FlyerView } from '@/lib/documents/openHouseFlyer'
import { COLORS } from './blocks'

function Qr({ url, size }: { url: string; size: number }) {
  const m = qrMatrix(url)
  const n = m.length + 2
  return (
    <Svg viewBox={`0 0 ${n} ${n}`} width={size} height={size}>
      <Rect x={0} y={0} width={n} height={n} fill="#FFFFFF" />
      {m.flatMap((row, r) => row.map((dark, c) => (dark ? <Rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1.02} height={1.02} fill={COLORS.ink} /> : null)))}
    </Svg>
  )
}

function Initials({ name, size, dark }: { name: string; size: number; dark?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? '#22407A' : COLORS.tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: size * 0.32, color: dark ? '#FFFFFF' : COLORS.navy }}>
        {name
          .split(/\s+/)
          .map((w) => w[0])
          .slice(0, 2)
          .join('')}
      </Text>
    </View>
  )
}

export function OpenHouseFlyerPdf({ flyer: f, scale }: { flyer: FlyerView; scale: number }) {
  const z = (n: number) => Math.round(n * scale * 100) / 100
  const pad = 43
  return (
    <Document title={`Open house · ${f.dateLine}`} author={f.company.name}>
      <Page size="LETTER" style={{ fontFamily: 'Helvetica', fontSize: z(9), color: COLORS.ink, paddingBottom: 30 }}>
        {/* Hero photo, with the OPEN HOUSE tab on its bottom edge. */}
        <View style={{ height: z(262), backgroundColor: COLORS.tint }}>
          {f.hero ? (
            <Image src={f.hero} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Image src={logo} style={{ height: z(50), width: z(50 * (775 / 399)), objectFit: 'contain', opacity: 0.5 }} />
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: pad }}>
          <View style={{ marginTop: z(-17), alignSelf: 'flex-start', backgroundColor: COLORS.navy, borderRadius: 5, paddingVertical: z(8), paddingHorizontal: z(16) }}>
            <Text style={{ color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: z(14), letterSpacing: 1.2 }}>OPEN HOUSE</Text>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: z(14) }}>
            <View style={{ flex: 1, paddingRight: z(12) }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(40), lineHeight: 1.05, color: COLORS.ink }}>{f.headline}</Text>
              <Text style={{ fontSize: z(14), marginTop: z(6) }}>{f.dateLine}</Text>
              {f.details && <Text style={{ fontSize: z(11.5), color: COLORS.muted, marginTop: z(3) }}>{f.details}</Text>}
            </View>
            {f.price && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: z(8.5), color: COLORS.muted, letterSpacing: 0.8 }}>OFFERED AT</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(30), color: COLORS.navy }}>{f.price}</Text>
              </View>
            )}
          </View>

          {f.rows.length > 0 && (
            <View style={{ marginTop: z(18) }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(12), marginBottom: z(6) }}>Financing options · estimated monthly payment</Text>
              <View style={{ flexDirection: 'row', backgroundColor: COLORS.navy, paddingVertical: z(7), paddingHorizontal: z(9) }}>
                {['Program', 'Down payment', 'Rate', 'Est. cash to close', 'Est. payment'].map((h, i) => (
                  <Text key={h} style={{ flex: i === 0 ? 1.2 : 1, textAlign: i === 0 ? 'left' : 'right', color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: z(9.5) }}>
                    {h}
                  </Text>
                ))}
              </View>
              {f.rows.map((r, i) => (
                <View key={r.program} style={{ flexDirection: 'row', paddingVertical: z(8), paddingHorizontal: z(9), backgroundColor: i % 2 === 0 ? COLORS.tint : '#FFFFFF', borderBottomWidth: 0.75, borderBottomColor: COLORS.line }}>
                  <Text style={{ flex: 1.2, fontFamily: 'Helvetica-Bold', fontSize: z(10.5) }}>{r.program}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', fontSize: z(10.5) }}>{r.down}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', fontSize: z(10.5) }}>{r.rate}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', fontSize: z(10.5) }}>{r.cashToClose}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: z(12) }}>{r.payment}</Text>
                </View>
              ))}
              <Text style={{ fontSize: z(8), color: COLORS.muted, marginTop: z(4) }}>{f.costsNote}</Text>
            </View>
          )}

          {/* QR, loan officer, listing agent. */}
          <View style={{ flexDirection: 'row', gap: z(10), marginTop: z(16) }}>
            <View style={{ flex: 1.1, flexDirection: 'row', alignItems: 'center', gap: z(10), borderWidth: 1.5, borderColor: COLORS.ink, borderRadius: 8, padding: z(9) }}>
              <Qr url={f.url} size={z(78)} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(12.5) }}>Scan to sign in</Text>
                <Text style={{ fontSize: z(9), color: COLORS.muted, marginTop: z(3) }}>Photos + your own payment breakdown</Text>
              </View>
            </View>
            <View style={{ flex: 1.1, flexDirection: 'row', alignItems: 'center', gap: z(9), backgroundColor: COLORS.navy, borderRadius: 8, padding: z(10) }}>
              {f.lo.photo ? <Image src={f.lo.photo} style={{ width: z(52), height: z(52), borderRadius: z(26), objectFit: 'cover' }} /> : <Initials name={f.lo.name} size={z(52)} dark />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: z(12) }}>{f.lo.name}</Text>
                <Text style={{ color: '#D6DEEF', fontSize: z(8.5), marginTop: z(2) }}>{f.lo.line}</Text>
                {f.lo.phone && <Text style={{ color: '#FFFFFF', fontSize: z(8.5), marginTop: z(1) }}>{f.lo.phone}</Text>}
                {f.lo.email && <Text style={{ color: '#FFFFFF', fontSize: z(8.5) }}>{f.lo.email}</Text>}
              </View>
            </View>
            {f.agent && (
              <View style={{ flex: 0.9, flexDirection: 'row', alignItems: 'center', gap: z(8), borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, padding: z(9) }}>
                {f.agent.photo ? <Image src={f.agent.photo} style={{ width: z(40), height: z(40), borderRadius: z(20), objectFit: 'cover' }} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: z(7.5), color: COLORS.muted, letterSpacing: 0.6 }}>LISTING AGENT</Text>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: z(11), marginTop: z(2) }}>{f.agent.name}</Text>
                  {f.agent.line && <Text style={{ fontSize: z(8.5), color: COLORS.muted }}>{f.agent.line}</Text>}
                  {f.agent.phone && <Text style={{ fontSize: z(8.5), color: COLORS.muted }}>{f.agent.phone}</Text>}
                </View>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: z(10), borderTopWidth: 0.75, borderTopColor: COLORS.line, marginTop: z(14), paddingTop: z(9) }}>
            <Image src={logo} style={{ height: z(26), width: z(26 * (775 / 399)), objectFit: 'contain' }} />
            <Text style={{ flex: 1, fontSize: z(7.5), color: COLORS.muted, lineHeight: 1.45 }}>{f.disclaimer}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
