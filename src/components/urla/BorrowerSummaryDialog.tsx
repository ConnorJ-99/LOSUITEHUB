// "Borrower summary" on the 1003 tab (Connor, 2026-11-24; replaced the
// Borrower Profile tab). Writes an internal summary from the saved file (the
// 1003, income worksheets, Max Approval, statements on file, whether credit is
// pulled), lets Connor change any of the words, and downloads the PDF laid out
// like his sample. Nothing is saved to Documents or sent. The strategy,
// strengths, review and next steps are kept on the file (loan_assessments) so
// they're there next time; "Draft with AI" fills only the empty ones.
import { useMemo, useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, TextArea } from '@/components/shared'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { OCCUPANCY_OPTIONS, MORTGAGE_TYPE_OPTIONS, REO_DISPOSITION_OPTIONS } from '@/components/profile/options'
import { draftAssessment, useAssessment, useSaveAssessment, type Assessment, type AssessmentField } from '@/lib/api/assessment'
import { useLoanDocuments } from '@/lib/api/documents'
import { useWorksheets } from '@/lib/api/income'
import { useLoanFile } from '@/lib/api/loanfile'
import { useNotes } from '@/lib/api/notes'
import { useFeeTemplates } from '@/lib/api/pricing'
import { useOrganization } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { maxApproval } from '@/lib/calc'
import { nowIso, todayIso } from '@/lib/dates'
import { borrowerSummaryView, summaryDefaults, type SummaryFacts, type SummaryText } from '@/lib/documents/borrowerSummary'
import { joinNames, worksheetFileName } from '@/lib/documents/feeWorksheet'
import { prequalFeeEstimate, selectedClosingCosts } from '@/lib/estimates/prequal'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { approvalFacts, approvalFormFrom, approvalInput } from '@/lib/prequal/maxApproval'
import { draftFrom, prequalSummary } from '@/lib/prequal/draft'
import { ASSET_GROUP_LABEL, QUALIFICATION_LABEL, assetLines, assetTotals, fig, incomeVerification, jobLines, liabilityLines, qualification, reoLines, type AssetGroup } from '@/lib/profile/profile'
import { OTHER_INCOME_OPTIONS } from '@/lib/urla/options'
import { EditDialog } from './parts'

const STATEMENT_KINDS = ['bank_statement', 'investment_statement']
const label = (opts: readonly { value: string; label: string }[], v: string | null | undefined) => (v ? (opts.find((o) => o.value === v)?.label ?? v.replace(/_/g, ' ')) : null)

/** The four words kept on the file between downloads, and where each lives in loan_assessments. */
const KEPT: [keyof SummaryText, AssessmentField][] = [
  ['strategy', 'strategy'],
  ['strengths', 'strengths'],
  ['review', 'concerns'],
  ['nextSteps', 'next_steps'],
]

export function BorrowerSummaryDialog({ loan, app, properties, onClose }: { loan: LoanProfile; app: Application; properties: Property[]; onClose: () => void }) {
  const templates = useFeeTemplates()
  const org = useOrganization()
  const worksheets = useWorksheets(loan.id)
  const file = useLoanFile(loan.id)
  const docs = useLoanDocuments(loan.id)
  const assessment = useAssessment(loan.id)
  const ready = templates.isSuccess && org.isSuccess && worksheets.data && file.data && docs.data && !assessment.isLoading

  const facts = useMemo((): SummaryFacts | null => {
    if (!ready) return null
    const isPurchase = loan.purpose === 'purchase'
    const draft = draftFrom(loan, app, properties, false)
    const feeEstimate = prequalFeeEstimate(loan, templates.data ?? [])
    const summary = prequalSummary(loan, draft, properties, feeEstimate)
    let maxPrice: number | null = null
    if (isPurchase) {
      const form = approvalFormFrom(loan.details)
      const input = approvalInput(draft.loan, form, approvalFacts(draft, summary, org.data, selectedClosingCosts(loan.details)))
      const approval = maxApproval({
        ...input,
        costsAt: input.costsAt ?? (feeEstimate && ((price, loanAmount) => feeEstimate(price, loanAmount, { mortgageType: draft.loan.mortgageType, noteRate: draft.loan.noteRate, termMonths: draft.loan.termMonths, occupancy: form.occupancy, upfrontFeePct: draft.loan.upfrontFeePct }))),
      })
      maxPrice = approval?.max?.price ?? null
    }
    const ws = worksheets.data!.map((w) => ({ contactId: w.contactId, employmentId: w.employmentId, status: w.status, pushedMonthly: w.pushedMonthly }))
    const nameOf = (contactId: string) => app.borrowers.find((b) => b.contactId === contactId)?.person.firstName ?? ''
    const jobs = jobLines(app.borrowers.flatMap((b) => b.employments), ws)
    const creditPulled = !!file.data!.marks.some((m) => m.stepKey === 'credit' && m.status === 'done')
    const statementContacts = [...new Set(docs.data!.filter((d) => STATEMENT_KINDS.includes(d.kind) && d.contactId).map((d) => d.contactId!))]
    const assets = assetLines(app.assets, statementContacts)
    const totals = assetTotals(assets, null)
    const debts = liabilityLines(app.liabilities, creditPulled)
    const owned = properties.filter((p) => p.id !== loan.details.subjectPropertyId && (p.status === 'current_home' || p.status === 'owned'))
    const reo = reoLines(owned.map((p) => ({ id: p.id, addressLine: p.addressLine, city: p.city, status: p.status, occupancy: p.reoOccupancy, disposition: p.reoDisposition, estimatedValue: p.estimatedValue, monthlyRent: p.monthlyRent, annualTaxes: p.annualTaxes, annualInsurance: p.annualInsurance, monthlyHoa: p.monthlyHoa, liens: p.liens.map((l) => ({ balance: l.balance, monthlyPayment: l.monthlyPayment })) })))
    const anyIncome = jobs.some((j) => j.current && j.monthly.value != null) || app.borrowers.some((b) => b.otherIncomes.length > 0)
    const verified = incomeVerification(jobs)
    const price = loan.details.purchasePrice
    const groups = (Object.keys(ASSET_GROUP_LABEL) as AssetGroup[]).filter((g) => assets.some((x) => x.group === g))
    return {
      borrowerNames: app.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`.trim()),
      isPurchase,
      purposeLabel: purposeLabel(loan.purpose),
      stageLabel: stageLabel(loan.stage),
      qualificationLabel: QUALIFICATION_LABEL[qualification(loan.stage, null).status],
      loName: loan.assignedLo?.name ?? 'Unassigned',
      targetPrice: isPurchase ? price : null,
      maxPrice,
      downPaymentPct: isPurchase && price && summary.cash ? (summary.cash.downPayment / price) * 100 : null,
      loanAmount: summary.loanAmount,
      programLabel: loan.details.programName ?? label(MORTGAGE_TYPE_OPTIONS, draft.loan.mortgageType),
      scores: app.borrowers.map((b) => ({ name: b.person.firstName, score: b.estimatedCreditScore })),
      creditPulled,
      jobs: jobs.map((j) => ({ name: nameOf(j.contactId), employer: j.employer, type: j.type, current: j.current, startDate: j.startDate, monthly: j.monthly })),
      otherIncome: app.borrowers.flatMap((b) => b.otherIncomes.map((o) => ({ name: b.person.firstName, type: label(OTHER_INCOME_OPTIONS, o.incomeType) ?? 'Other income', monthly: o.monthlyAmount }))),
      income: anyIncome ? fig(summary.totalIncome, verified === 'verified' ? 'verified' : 'reported') : fig(null, 'reported'),
      incomeVerified: verified,
      dti: anyIncome && summary.dti.front != null ? { front: summary.dti.front, back: summary.dti.back } : null,
      assetGroups: groups.map((g) => {
        const xs = assets.filter((x) => x.group === g)
        return { label: ASSET_GROUP_LABEL[g], total: xs.some((x) => x.amount.value != null) ? xs.reduce((n, x) => n + (x.amount.value ?? 0), 0) : null, verified: xs.every((x) => x.amount.source === 'verified') }
      }),
      liquid: totals.liquid,
      debts: debts.lines.map((d) => ({ name: d.name, balance: d.balance.value, payment: d.payment.value, paidOff: d.paidOff })),
      monthlyDebts: debts.monthly,
      homes: reo.map((h) => ({ address: h.address, value: h.value.value, balance: h.balance.value, plan: label(REO_DISPOSITION_OPTIONS, h.disposition), use: label(OCCUPANCY_OPTIONS, h.occupancy) })),
    }
  }, [ready, loan, app, properties, templates.data, org.data, worksheets.data, file.data, docs.data])

  if (!facts)
    return (
      <EditDialog title="Borrower summary" open onOpenChange={(o) => !o && onClose()} onSubmit={() => {}} submitLabel="Download PDF" saving>
        <p className="text-sm text-muted-foreground">Gathering the file…</p>
      </EditDialog>
    )
  return <SummaryForm loan={loan} facts={facts} saved={assessment.data ?? null} onClose={onClose} />
}

function SummaryForm({ loan, facts, saved, onClose }: { loan: LoanProfile; facts: SummaryFacts; saved: Assessment | null; onClose: () => void }) {
  const [text, setText] = useState<SummaryText>(() =>
    summaryDefaults(facts, saved ? { strategy: saved.text.strategy, strengths: saved.text.strengths, concerns: saved.text.concerns, nextSteps: saved.text.next_steps } : {}),
  )
  const [aiFields, setAiFields] = useState<AssessmentField[]>(saved?.aiFields ?? [])
  const [drafting, setDrafting] = useState(false)
  const [busy, setBusy] = useState(false)
  const pdf = useSavePdf(loan)
  const save = useSaveAssessment(loan.id, loan.organizationId)
  const notes = useNotes(loan.borrower?.id)
  const set = (k: keyof SummaryText) => (v: string) => setText((t) => ({ ...t, [k]: v }))
  const emptyKept = KEPT.filter(([k]) => !text[k].trim())

  const draft = async () => {
    setDrafting(true)
    try {
      const recentNotes = (notes.data ?? []).filter((n) => n.loanId === loan.id).slice(0, 8).map((n) => n.body.slice(0, 600))
      const r = await draftAssessment(loan.id, { ...facts, recentNotes })
      const filled: AssessmentField[] = []
      setText((t) => {
        const next = { ...t }
        for (const [k, f] of KEPT)
          if (!t[k].trim() && r.draft[f]?.trim()) {
            next[k] = r.draft[f].trim()
            filled.push(f)
          }
        return next
      })
      setAiFields((a) => [...new Set([...a, ...filled])])
      toast.success(filled.length ? 'AI filled the empty boxes. Read them before downloading.' : 'Nothing was empty; nothing was replaced.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  const download = async () => {
    setBusy(true)
    try {
      // Keep the strategy, strengths, review and next steps on the file for next time (when the assessment script has run).
      if (saved) {
        const next = { ...saved.text }
        for (const [k, f] of KEPT) next[f] = text[k]
        if (KEPT.some(([, f]) => next[f].trim() !== saved.text[f].trim())) save.mutate({ text: next, aiFields })
      }
      const view = borrowerSummaryView(facts, text, todayIso())
      const made = await pdf.preview((lib, brand) => lib.borrowerSummaryPdf(view, brand))
      if ('error' in made) return toast.error('The summary is longer than 4 pages. Shorten some of the boxes.')
      const a = document.createElement('a')
      a.href = made.url
      const name = worksheetFileName('Borrower Summary', joinNames(facts.borrowerNames), nowIso())
      a.download = name.endsWith('.pdf') ? name : `${name}.pdf`
      a.click()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ai = (f: AssessmentField) => (aiFields.includes(f) ? ' · AI draft' : '')
  return (
    <EditDialog
      title="Borrower summary"
      description="Internal and confidential. Written from the saved file; change any of the words, then download. Nothing is saved to Documents or sent."
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      onSubmit={() => void download()}
      saving={busy || !pdf.ready}
      submitLabel="Download PDF"
    >
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" disabled={drafting || emptyKept.length === 0} onClick={() => void draft()} title={emptyKept.length ? 'Fills the empty strategy, strengths, review and next steps' : 'Those boxes all have words'}>
          <SparklesIcon /> {drafting ? 'Drafting…' : 'Draft with AI'}
        </Button>
      </div>
      <TextArea label={`${facts.purposeLabel} strategy${ai('strategy')}`} value={text.strategy} onChange={set('strategy')} rows={3} hint="Left out of the PDF when blank." />
      <p className="text-sm font-semibold">Financial profile</p>
      <TextArea label="Income / employment" value={text.income} onChange={set('income')} rows={2} />
      <TextArea label="Credit" value={text.credit} onChange={set('credit')} rows={2} />
      <TextArea label="Assets" value={text.assets} onChange={set('assets')} rows={2} />
      <TextArea label="Liabilities" value={text.liabilities} onChange={set('liabilities')} rows={2} />
      <TextArea label="Real estate owned" value={text.homes} onChange={set('homes')} rows={2} />
      {facts.isPurchase && (
        <>
          <p className="text-sm font-semibold">Illustrative financing scenarios</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Input label="Purchase prices" value={text.prices} onChange={set('prices')} hint="Separate with commas, e.g. 650000, 750000, 850k. Blank = no table." />
            <Input label="Down payment %" value={text.downPct} onChange={set('downPct')} inputMode="decimal" />
          </div>
          <TextArea label="Note under the table" value={text.scenarioNote} onChange={set('scenarioNote')} rows={2} />
        </>
      )}
      <p className="text-sm font-semibold">Loan officer assessment</p>
      <TextArea label={`Strengths${ai('strengths')}`} value={text.strengths} onChange={set('strengths')} rows={2} />
      <TextArea label={`Review${ai('concerns')}`} value={text.review} onChange={set('review')} rows={3} hint="What still needs confirming." />
      <TextArea label={`Next steps${ai('next_steps')}`} value={text.nextSteps} onChange={set('nextSteps')} rows={4} hint="One per line; numbered on the PDF." />
    </EditDialog>
  )
}
