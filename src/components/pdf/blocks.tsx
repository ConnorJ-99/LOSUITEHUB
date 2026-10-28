// Shared pieces of every LOSuite PDF (@react-pdf/renderer), styled after the
// MPS document templates (base.css): letterhead, title row, the Equal Housing
// footer and amount tables. Sizes take a scale so a document can shrink to fit
// one page. The built-in Helvetica only has Western characters, so text uses a
// plain hyphen for minus.

import { Image, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import logo from '@/assets/mps-logo.png'
import type { DocBrand } from '@/lib/documents/brand'
import { formatCurrency } from '@/lib/format'

export const COLORS = { navy: '#053095', accent: '#1F4FBF', ink: '#1B2430', muted: '#5B6676', line: '#D5DBE3', tint: '#F2F5F9' }

export type { DocBrand }

/** Styles at a scale (1 = the template's sizes). Page margins don't shrink. */
export function pdfStyles(scale: number) {
  const z = (n: number) => Math.round(n * scale * 100) / 100
  return StyleSheet.create({
    page: { paddingTop: 36, paddingHorizontal: 43, paddingBottom: 40, fontFamily: 'Helvetica', fontSize: z(9), lineHeight: 1.4, color: COLORS.ink },
    letterhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: z(8), borderBottomWidth: 2, borderBottomColor: COLORS.navy, marginBottom: z(11) },
    logo: { height: z(40), width: z(40 * (775 / 399)), objectFit: 'contain' },
    /** An uploaded logo: as tall as the built-in one, never wider than the letterhead allows. */
    customLogo: { height: z(40), maxWidth: z(180), objectFit: 'contain', objectPosition: 'left' },
    sub: { fontSize: z(7.8), color: COLORS.muted, marginTop: z(3) },
    contact: { textAlign: 'right', fontSize: z(8), color: COLORS.muted, lineHeight: 1.5 },
    contactName: { color: COLORS.ink, fontSize: z(8.8), fontFamily: 'Helvetica-Bold' },
    titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: z(12) },
    eyebrow: { fontSize: z(8), color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    h1: { fontSize: z(17), lineHeight: 1.2, color: COLORS.navy, fontFamily: 'Helvetica-Bold' },
    h2: { fontSize: z(9.6), color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'Helvetica-Bold', marginTop: z(4), marginBottom: z(5) },
    h3: { fontSize: z(9.6), fontFamily: 'Helvetica-Bold', marginBottom: z(2) },
    meta: { fontSize: z(8), color: COLORS.muted, textAlign: 'right', lineHeight: 1.5 },
    callout: { backgroundColor: COLORS.tint, borderLeftWidth: 3, borderLeftColor: COLORS.accent, paddingVertical: z(6), paddingHorizontal: z(10), marginBottom: z(9), fontFamily: 'Helvetica-Bold' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: COLORS.line, borderRadius: 5, marginBottom: z(12) },
    cell: { width: '33.333%', paddingVertical: z(3.5), paddingHorizontal: z(8), borderColor: COLORS.line },
    cellLabel: { fontSize: z(7), color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
    cellValue: { fontFamily: 'Helvetica-Bold' },
    columns: { flexDirection: 'row', gap: z(14) },
    column: { flex: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: z(1), fontSize: z(8.3) },
    subRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: z(4.5), paddingBottom: z(1), fontSize: z(8), color: COLORS.muted, fontFamily: 'Helvetica-Bold' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: z(2), paddingTop: z(4), fontSize: z(8.3), fontFamily: 'Helvetica-Bold' },
    label: { flex: 1, paddingRight: z(6) },
    note: { color: COLORS.muted, fontSize: z(7.4) },
    amount: { textAlign: 'right' },
    box: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 5, paddingVertical: z(6), paddingHorizontal: z(9), marginBottom: z(6) },
    tintBox: { backgroundColor: COLORS.tint, borderRadius: 5, paddingVertical: z(4), paddingHorizontal: z(10), marginTop: z(7), marginBottom: z(7) },
    tiny: { fontSize: z(7.2), lineHeight: 1.4, color: COLORS.muted, marginTop: z(4) },
    eho: { flexDirection: 'row', alignItems: 'center', gap: z(8), marginTop: z(10), paddingTop: z(6), borderTopWidth: 1, borderTopColor: COLORS.line, fontSize: z(7.4), color: COLORS.muted },
  })
}
export type PdfStyles = ReturnType<typeof pdfStyles>

/** "$1,250" or "-$1,250". */
export const money = (amount: number, negative = false) => `${negative ? '-' : ''}${formatCurrency(amount)}`

export function Letterhead({ brand, s }: { brand: DocBrand; s: PdfStyles }) {
  const { company, lo } = brand
  return (
    <View style={s.letterhead}>
      <View>
        <Image src={company.logo ?? logo} style={company.logo ? s.customLogo : s.logo} />
        <Text style={s.sub}>
          NMLS #{company.nmls ?? '—'}
          {company.address ? ` · ${company.address}` : ''}
        </Text>
      </View>
      <View style={s.contact}>
        <Text style={s.contactName}>{lo.name}</Text>
        <Text>Loan Officer{lo.nmls ? ` · NMLS #${lo.nmls}` : ''}</Text>
        <Text>{[lo.phone, lo.email].filter(Boolean).join(' · ')}</Text>
      </View>
    </View>
  )
}

export function TitleRow({ eyebrow, title, meta, s }: { eyebrow: string; title: string; meta: string[]; s: PdfStyles }) {
  return (
    <View style={s.titleRow}>
      <View>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.h1}>{title}</Text>
      </View>
      <View style={s.meta}>
        {meta.map((m) => (
          <Text key={m}>{m}</Text>
        ))}
      </View>
    </View>
  )
}

/** Labeled facts, three to a row. */
export function FactGrid({ facts, s }: { facts: { label: string; value: string }[]; s: PdfStyles }) {
  const rows = Math.ceil(facts.length / 3)
  return (
    <View style={s.grid}>
      {facts.map((f, i) => (
        <View key={f.label} style={[s.cell, { borderRightWidth: i % 3 === 2 ? 0 : 1, borderBottomWidth: Math.floor(i / 3) === rows - 1 ? 0 : 1 }]}>
          <Text style={s.cellLabel}>{f.label}</Text>
          <Text style={s.cellValue}>{f.value}</Text>
        </View>
      ))}
    </View>
  )
}

export function AmountRow({ label, note, amount, negative, bold, kind = 'row', s }: { label: string; note?: string | null; amount: number | null; negative?: boolean; bold?: boolean; kind?: 'row' | 'sub' | 'total'; s: PdfStyles }) {
  return (
    <View style={[kind === 'sub' ? s.subRow : kind === 'total' ? s.totalRow : s.row, ...(bold ? [{ fontFamily: 'Helvetica-Bold' }] : [])]} wrap={false}>
      <Text style={s.label}>
        {label}
        {note ? <Text style={s.note}> ({note})</Text> : null}
      </Text>
      <Text style={s.amount}>{amount == null ? '' : money(amount, negative)}</Text>
    </View>
  )
}

/** Equal Housing Opportunity with the company's NMLS and NMLS Consumer Access. */
export function EhoFooter({ brand, s }: { brand: DocBrand; s: PdfStyles }) {
  const { company } = brand
  return (
    <View style={s.eho} wrap={false}>
      <Svg viewBox="0 0 24 24" width={18} height={18}>
        <Path d="M3 11 L12 4 L21 11" stroke={COLORS.muted} strokeWidth={1.6} fill="none" />
        <Path d="M5 10 V20 H19 V10" stroke={COLORS.muted} strokeWidth={1.6} fill="none" />
        <Path d="M9 14 H15 M9 17 H15" stroke={COLORS.muted} strokeWidth={1.6} fill="none" />
      </Svg>
      <Text style={{ flex: 1 }}>
        Equal Housing Opportunity. {company.legalName}, NMLS #{company.nmls ?? '—'}
        {company.address ? `, ${company.address}` : ''}. NMLS Consumer Access: www.nmlsconsumeraccess.org.
      </Text>
    </View>
  )
}
