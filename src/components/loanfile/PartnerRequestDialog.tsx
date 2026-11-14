// "Send title request" / "Send insurance request" (Connor, 2026-11-14, from
// his drafts): the email filled in from the file, every line editable, and a
// preview of exactly what goes out. Nothing sends until Connor clicks Send and
// confirms; it goes through GoHighLevel to the partner on the file.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { confirmAction, FormGrid, Input, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useLoan } from '@/lib/api/loans'
import { useFilePeople } from '@/lib/api/messages'
import { useSendPartnerEmail } from '@/lib/api/partnerRequests'
import { usePartners } from '@/lib/api/partners'
import { useProperties } from '@/lib/api/properties'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { formatPhone } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'
import { DEFAULT_FORWARD, REQUEST_LABEL, requestAddress, requestBody, requestRows, requestSubject, type RequestFacts, type RequestKind, type RequestRow } from '@/lib/partners/requestEmail'

export function PartnerRequestDialog({
  kind,
  loanId,
  partnerId,
  clause,
  lenderLoanNumber,
  onClose,
}: {
  kind: RequestKind
  loanId: string
  partnerId: string
  clause: string | null
  lenderLoanNumber: string | null
  onClose: () => void
}) {
  const loan = useLoan(loanId)
  const people = useFilePeople(loanId)
  const properties = useProperties(loanId)
  const org = useOrganization()
  const lo = useProfile(loan.data?.assignedLo?.id)
  const partners = usePartners()
  const partner = partners.data?.find((p) => p.id === partnerId) ?? null

  const facts = useMemo((): RequestFacts | null => {
    if (!loan.data || !people.data || !properties.data || !org.data) return null
    const l = loan.data
    const names = people.data.map((p) => `${p.firstName} ${p.lastName}`.trim())
    const subject = properties.data.find((p) => p.id === l.details.subjectPropertyId) ?? null
    const waived = l.details.impoundWaiver === 'insurance' || l.details.impoundWaiver === 'all'
    return {
      companyName: org.data.name,
      companyNmls: org.data.nmls,
      borrowerName: names[0] ?? '',
      coBorrowerName: names[1] ?? null,
      additionalBorrowers: names.slice(2),
      propertyAddress: requestAddress(subject),
      loanNumber: lenderLoanNumber,
      loanAmount: l.loanAmount,
      mortgageeClause: clause,
      purpose: purposeLabel(l.purpose),
      closingDate: l.closingDate,
      insuranceEscrow: waived ? 'Waived' : 'Impounded',
      lo: { name: lo.data?.fullName ?? l.assignedLo?.name ?? null, nmls: lo.data?.nmls ?? null, phone: lo.data?.phone ? formatPhone(lo.data.phone) : null, email: lo.data?.email ?? null },
    }
  }, [loan.data, people.data, properties.data, org.data, lo.data, clause, lenderLoanNumber])

  if (!facts || !partner || (loan.data?.assignedLo && lo.isLoading)) {
    return (
      <EditDialog title={REQUEST_LABEL[kind]} open onOpenChange={(o) => !o && onClose()} onSubmit={() => {}} saving submitLabel="Send">
        <p className="text-sm text-muted-foreground">{partners.data && !partner ? 'That partner was not found.' : 'Loading the file…'}</p>
      </EditDialog>
    )
  }
  return <RequestForm kind={kind} loanId={loanId} facts={facts} partner={partner} onClose={onClose} />
}

function RequestForm({
  kind,
  loanId,
  facts,
  partner,
  onClose,
}: {
  kind: RequestKind
  loanId: string
  facts: RequestFacts
  partner: { id: string; name: string; company: string | null; email: string | null; emailConsent: boolean | null; emailOptedOutAt: string | null }
  onClose: () => void
}) {
  const send = useSendPartnerEmail(loanId)
  const [rows, setRows] = useState<RequestRow[]>(() => requestRows(kind, facts, DEFAULT_FORWARD[kind]))
  const [subject, setSubject] = useState(() => requestSubject(kind, facts))
  const [recordConsent, setRecordConsent] = useState(false)
  // One key per request, so a double click or a retry can't send it twice.
  const [key] = useState(() => crypto.randomUUID())
  const body = requestBody(kind, rows, facts)
  const setRow = (k: string, value: string) => setRows((all) => all.map((r) => (r.key === k ? { ...r, value } : r)))
  const who = [partner.company, partner.name].filter(Boolean).join(' · ')
  const needsConsent = partner.emailConsent !== true && !partner.emailOptedOutAt

  return (
    <EditDialog
      title={`${REQUEST_LABEL[kind]} to ${partner.company || partner.name}`}
      description="Filled in from the file. Change anything, check the preview, then Send. It goes through GoHighLevel from your email."
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      saving={send.isPending}
      submitLabel="Send"
      onSubmit={async () => {
        if (!partner.email) return toast.error(`${partner.name} has no email address. Add it on the partner first.`)
        if (partner.emailOptedOutAt) return toast.error(`${partner.name} opted out of email.`)
        if (needsConsent && !recordConsent) return toast.error('Tick that they take email about this file first.')
        if (!subject.trim()) return toast.error('Add a subject')
        if (!(await confirmAction(`Send this ${REQUEST_LABEL[kind].toLowerCase()} to ${who} at ${partner.email}?`, { confirmLabel: 'Send', title: 'Send through GoHighLevel' }))) return
        send.mutate(
          { partnerId: partner.id, subject: subject.trim(), body, key, recordConsent: needsConsent && recordConsent },
          {
            onSuccess: () => {
              toast.success(`${REQUEST_LABEL[kind]} sent to ${partner.company || partner.name}`)
              onClose()
            },
            onError: (e) => toast.error(e.message),
          },
        )
      }}
    >
      <FormGrid>
        <Input label="To" value={partner.email ? `${who} <${partner.email}>` : `${who} (no email on file)`} readOnly span={6} />
        <Input label="Subject" value={subject} onChange={setSubject} span={6} />
        {rows.map((r) =>
          r.key === 'clause' || r.key === 'forward' ? (
            <TextArea key={r.key} label={r.label} value={r.value} onChange={(v) => setRow(r.key, v)} rows={r.key === 'clause' ? 4 : 2} span={6} />
          ) : (
            <Input key={r.key} label={r.label} value={r.value} onChange={(v) => setRow(r.key, v)} span={r.key === 'address' ? 6 : 3} />
          ),
        )}
      </FormGrid>
      {needsConsent && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          <input type="checkbox" className="mt-0.5" checked={recordConsent} onChange={(e) => setRecordConsent(e.target.checked)} />
          <span>{partner.name} has no email consent on file. Tick to record that they take email about this file (a business partner on the loan).</span>
        </label>
      )}
      {partner.emailOptedOutAt && <p className="text-sm text-red-700">{partner.name} opted out of email, so this can't be sent.</p>}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Preview: exactly what they'll get</p>
        <pre className="max-h-72 overflow-y-auto rounded-md border bg-muted/40 p-3 font-sans text-xs whitespace-pre-wrap">{`Subject: ${subject}\n\n${body}`}</pre>
      </div>
    </EditDialog>
  )
}
