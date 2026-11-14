import { useEffect, useRef, useState } from 'react'
import { ArrowRightIcon, CheckIcon, FileTextIcon, RefreshCwIcon, RotateCcwIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, FormGrid, Input, NumberInput, PercentInput, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { ReviewFees } from '@/components/pricing/ReviewFees'
import { SendSavedPdf } from '@/components/messages/SendDocumentDialog'
import { newProgramOption } from '@/lib/api/estimates'
import { lenderClause, useLenders } from '@/lib/api/lenders'
import { mortgageeClause } from '@/lib/loans/mortgagee'
import { useSaveRow } from '@/lib/api/urla'
import type { LoanProfile } from '@/lib/api/types'
import { pct, pointsAmount, prepaidInterestDays, round, type FeeOverride } from '@/lib/calc'
import { formatIsoDate, nowIso } from '@/lib/dates'
import { joinNames } from '@/lib/documents/feeWorksheet'
import {
  MORTGAGE_TYPE_FOR_FAMILY,
  activeRules,
  changedSincePriced,
  computeEstimate,
  estimateChanges,
  estimateLender,
  estimateName,
  estimateProgramName,
  factsFingerprint,
  feeChanges,
  refreshFromLoan,
  type Estimate,
  type EstimateDraft,
} from '@/lib/estimates/estimate'
import { formatCurrency, formatPercent } from '@/lib/format'
import { purposeLabel } from '@/lib/pipeline/stages'
import { useEstimatePdf } from './useEstimatePdf'
import { DpaFields } from './DpaFields'
import { draftOf, type EstimateData } from './useEstimateData'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'waiting'

interface Props {
  loan: LoanProfile
  estimate: Estimate
  data: EstimateData
  /** This estimate is Selected for the file. */
  selected: boolean
  onSelect: (e: Estimate) => void
  /** Open another estimate (after "No, save as a new draft"). */
  onOpen: (id: string) => void
  onCompare: () => void
  onSaveState: (s: SaveState) => void
}

const AUTOSAVE_MS = 900

/** One open estimate: the step rail, its five sections and the summary, saved as you type. */
export function EstimateEditor({ loan, estimate, data, selected, onSelect, onOpen, onCompare, onSaveState }: Props) {
  const [draft, setDraft] = useState<EstimateDraft>(() => draftOf(estimate))
  const [overrides, setOverrides] = useState<FeeOverride[]>(() => data.feesOf(estimate.id))
  const [state, setState] = useState<SaveState>('saved')
  const saveRow = useSaveRow(loan.id, loan.organizationId, 'liabilities')
  const lenders = useLenders()
  const [picked, setPicked] = useState<{ lenderId: string | null; programId: string | null; oldAuto: string } | null>(null)
  const pdf = useEstimatePdf(loan, data)
  const isPurchase = loan.purpose === 'purchase'

  const savedDraft = draftOf(estimate)
  const dirty = Object.keys(estimateChanges(savedDraft, draft)).filter((k) => !['figures', 'pricedAt'].includes(k)).length > 0 || feeChanges(data.feesOf(estimate.id), overrides).upsert.length + feeChanges(data.feesOf(estimate.id), overrides).remove.length > 0
  const holdForFile = selected && dirty

  // Autosave (Drafts). The Selected estimate waits for "Update the file too?".
  const latest = useRef({ draft, overrides, estimate, holdForFile })
  latest.current = { draft, overrides, estimate, holdForFile }
  useEffect(() => {
    if (!dirty) return void setState('saved')
    if (selected) return void setState('waiting')
    setState('unsaved')
    const t = setTimeout(async () => {
      setState('saving')
      try {
        const ready = await data.save(estimate, draft, overrides)
        setDraft((d) => withSaved(d, ready))
        await data.refresh()
        setState('saved')
      } catch (e) {
        setState('unsaved')
        toast.error(`Could not save: ${(e as Error).message}`)
      }
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [draft, overrides, dirty, selected])
  useEffect(() => onSaveState(state), [state, onSaveState])

  // Leaving the Selected estimate with changes nobody answered: keep them as a new Draft, never change the file by surprise.
  useEffect(
    () => () => {
      const l = latest.current
      if (!l.holdForFile) return
      const name = estimateName(`${l.draft.name} (edit)`, data.list.map((x) => x.name))
      data
        .create({ ...l.draft, name, archivedAt: null }, l.overrides)
        .then(() => data.refresh())
        .then(() => toast.success(`Your changes to "${l.estimate.name}" were saved as a new draft, "${name}". The file didn't change.`))
        .catch((e: Error) => toast.error(`Could not keep your changes: ${e.message}`))
    },
    [],
  )

  const set =
    <K extends keyof EstimateDraft>(key: K) =>
    (value: EstimateDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value }))

  const currentFacts = data.factsFor(draft.propertyId)
  const facts = draft.loanSnapshot?.facts ?? currentFacts
  const r = computeEstimate(draft, overrides, data.templates, facts)
  const f = r.saved
  const changed = changedSincePriced(draft.loanSnapshot, currentFacts, draft)

  const refreshFromCurrent = () =>
    setDraft((d) => ({ ...d, ...refreshFromLoan(d, d.loanSnapshot!.facts, currentFacts), feeRules: activeRules(data.templates, estimate.program?.lenderId ?? null), feesGeneratedAt: nowIso() }))
  const keepAsIs = () => setDraft((d) => ({ ...d, loanSnapshot: d.loanSnapshot && { ...d.loanSnapshot, keptFingerprint: factsFingerprint(currentFacts) } }))
  const regenerate = () => {
    setDraft((d) => ({ ...d, feeRules: activeRules(data.templates, estimate.program?.lenderId ?? null), feesGeneratedAt: nowIso() }))
    toast.success(overrides.length ? `Fees rebuilt from the fee list. Your ${overrides.length} edit${overrides.length > 1 ? 's were' : ' was'} kept.` : 'Fees rebuilt from the fee list.')
  }
  const resetAll = async () => {
    if (!overrides.length) return
    if (await confirmAction(`Remove all ${overrides.length} fee edits on "${draft.name}"? The fees go back to the calculated amounts.`, { confirmLabel: 'Reset all' })) setOverrides([])
  }
  const saveFee = (o: FeeOverride) => setOverrides((list) => [...list.filter((x) => x.key !== o.key), o])
  const resetFee = (key: string) => setOverrides((list) => list.filter((x) => x.key !== key))

  // "Update the file too?"
  const [answering, setAnswering] = useState(false)
  const updateFile = async () => {
    setAnswering(true)
    try {
      const ready = await data.save(estimate, draft, overrides)
      setDraft((d) => withSaved(d, ready))
      await data.refresh()
      onSelect({ ...estimate, ...ready })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAnswering(false)
    }
  }
  const saveAsDraft = async () => {
    setAnswering(true)
    try {
      const name = estimateName(`${draft.name} (edit)`, data.list.map((x) => x.name))
      const created = await data.create({ ...draft, name, archivedAt: null }, overrides)
      await data.refresh()
      setDraft(savedDraft)
      setOverrides(data.feesOf(estimate.id))
      toast.success(`Saved as a new draft, "${name}". The file didn't change.`)
      onOpen(created.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAnswering(false)
    }
  }

  // The 1003's "paid off at closing", from inside the estimate.
  const togglePayoff = async (id: string, on: boolean) => {
    const debt = data.application.liabilities.find((l) => l.id === id)
    if (!debt) return
    try {
      await saveRow.mutateAsync({ id, contactId: debt.contactId, toBePaidOff: on })
      setDraft((d) => {
        const base = d.loanSnapshot?.facts ?? currentFacts
        return { ...d, loanSnapshot: { facts: { ...base, debts: base.debts.map((x) => (x.id === id ? { ...x, toBePaidOff: on } : x)) } } }
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const borrowerNames = pdf.borrowerNames
  const savePdf = () => pdf.save({ ...estimate, ...draft }, draft, overrides)

  const steps = [
    { title: 'Program & pricing', sub: [estimateProgramName({ ...estimate, ...draft }), formatPercent(draft.noteRate)].filter(Boolean).join(' · '), done: draft.noteRate != null && !!draft.loanAmount && !!draft.termMonths && !!draft.mortgageType },
    { title: 'Smart Fees', sub: `${r.priced.lines.filter((l) => l.atClosing || l.beforeClosing).length} fees${overrides.length ? ` · ${overrides.length} edited` : ''}`, done: r.priced.lines.length > 0 },
    { title: 'Payment & credits', sub: `${formatCurrency(f.pitia)}/mo`, done: f.pitia > 0 && f.taxes > 0 && f.hoi > 0 },
    { title: 'Cash to close & funds', sub: `${formatCurrency(Math.abs(f.cashToClose))}${f.reservesMonths != null ? ` · ${f.reservesMonths} mo left` : ''}`, done: f.availableFunds > 0 },
    { title: 'Loan Estimate', sub: 'Preview & download', done: false },
  ]
  const go = (n: number) => document.getElementById(`estimate-step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Lender and program: picked from the lender list (a new pick shows before the save comes back).
  const lenderList = (lenders.data ?? []).filter((l) => l.status !== 'inactive' || l.id === estimate.program?.lenderId)
  const lenderId = picked ? picked.lenderId : (estimate.program?.lenderId ?? lenderList.find((l) => l.name.toLowerCase() === (draft.lenderName ?? '').toLowerCase() || l.shortName?.toLowerCase() === (draft.lenderName ?? '').toLowerCase())?.id ?? null)
  const programId = picked ? picked.programId : (estimate.program?.programId ?? null)
  const chosenLender = lenderList.find((l) => l.id === lenderId) ?? null
  const lenderOptions = lenderList.map((l) => ({ value: l.id, label: l.name }))
  const programOptions = (chosenLender?.programs ?? []).filter((p) => p.active || p.id === programId).map((p) => ({ value: p.id, label: p.name }))
  // The name the estimate had from its program and lender before the first pick (so it can follow the new one).
  const autoName = picked?.oldAuto ?? `${estimateProgramName({ ...estimate, ...draft }) ?? ''} · ${estimateLender({ ...estimate, ...draft }) ?? ''}`
  const pickLender = (id: string | null) => {
    const l = lenderList.find((x) => x.id === id) ?? null
    setPicked({ lenderId: id, programId: null, oldAuto: autoName })
    // A new lender: its own charges apply, so the fee rules are picked again (your fee edits stay).
    setDraft((d) => ({ ...d, lenderName: l ? (l.shortName ?? l.name) : null, programName: null, programOptionId: null, feeRules: activeRules(data.templates, id), feesGeneratedAt: nowIso() }))
  }
  const pickProgram = async (id: string | null) => {
    const p = chosenLender?.programs.find((x) => x.id === id) ?? null
    setPicked({ lenderId, programId: id, oldAuto: autoName })
    if (!p) return setDraft((d) => ({ ...d, programName: null, programOptionId: null }))
    try {
      const optionId = await newProgramOption(loan.id, loan.organizationId, p.id)
      const mortgageType = MORTGAGE_TYPE_FOR_FAMILY[p.family]
      const newLender = chosenLender ? (chosenLender.shortName ?? chosenLender.name) : draft.lenderName
      // A name made from the program and lender ("FHA · Pennymac · Option B") follows the new pick; a name you typed stays.
      const oldAuto = autoName
      const name = draft.name.startsWith(oldAuto) ? `${p.name} · ${newLender ?? ''}${draft.name.slice(oldAuto.length)}` : draft.name
      setDraft((d) => ({ ...d, name, programOptionId: optionId, programName: p.name, lenderName: newLender, ...(mortgageType && { mortgageType }), feeRules: activeRules(data.templates, lenderId), feesGeneratedAt: nowIso() }))
      setPicked({ lenderId, programId: id, oldAuto: `${p.name} · ${newLender ?? ''}` })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const lender = picked ? (draft.lenderName ?? null) : estimateLender({ ...estimate, ...draft })
  // The lender's structured clause (else its old one-line clause); the loan # goes on the file's Settlement card.
  const mortgagee = chosenLender ? mortgageeClause(null, lenderClause(chosenLender), null).text : null

  return (
    <div className="space-y-3">
      <SendSavedPdf loan={loan} docId={pdf.sendingId} onClose={pdf.closeSend} />

      {changed.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="mr-auto">
            <span className="font-semibold">Loan changed since this estimate was priced{estimate.pricedAt ? ` (${formatIsoDate(estimate.pricedAt.slice(0, 10))})` : ''}:</span> {changed.join(' · ')}
          </p>
          <Button size="sm" variant="outline" onClick={keepAsIs}>
            Keep as is
          </Button>
          <Button size="sm" className="bg-money text-white hover:bg-money/90" onClick={refreshFromCurrent}>
            <RefreshCwIcon />
            Refresh with current loan
          </Button>
        </div>
      )}

      <div className="sticky top-14 z-10 grid grid-cols-2 md:top-11 overflow-hidden rounded-xl border bg-card shadow-soft sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Total loan" value={formatCurrency(f.totalLoanAmount)} hint={f.financedFee ? `incl. ${formatCurrency(f.financedFee)} financed` : purposeLabel(loan.purpose)} />
        <Tile label="Rate" value={formatPercent(f.ratePct)} hint={`${draft.termMonths ? draft.termMonths / 12 : '—'} yr · ${draft.pointsPct ? `${formatPercent(draft.pointsPct)} pts` : '0 pts'}`} />
        <Tile label="Monthly payment" value={formatCurrency(f.pitia)} hint={f.mi ? 'PITI + MI' : 'PITI'} money />
        <Tile label="Closing costs" value={formatCurrency(f.closingCosts)} hint="A–H, borrower-paid" money />
        <Tile label={r.cash.label} value={formatCurrency(Math.abs(f.cashToClose))} hint="after credits" money />
        <Tile label="Funds left" value={formatCurrency(f.fundsLeft)} hint={f.reservesMonths != null ? `${f.reservesMonths} mo reserves` : 'no assets on the 1003'} money={f.fundsLeft >= 0} warn={f.fundsLeft < 0} />
        <Tile label="DTI" value={f.dtiFront != null ? `${formatPercent(f.dtiFront, 1)} / ${formatPercent(f.dtiBack, 1)}` : '—'} hint={f.dtiFront != null ? 'front / back' : 'no income on the 1003'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,7fr)_minmax(0,4fr)] [&_[data-slot=card]]:[--card-spacing:--spacing(3)] [&_[data-slot=card-title]]:text-base">
        <aside className="space-y-3 lg:row-span-2">
          <Card contentClassName="p-2">
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <button type="button" onClick={() => go(i + 1)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted">
                    <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', s.done ? 'bg-nurture text-white' : 'border bg-card text-muted-foreground')}>{s.done ? <CheckIcon className="size-3.5" /> : i + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{s.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t px-2 pt-2 text-xs text-muted-foreground">
              {estimate.pricedAt ? `Priced ${formatIsoDate(estimate.pricedAt.slice(0, 10))}` : 'Not saved yet'}
              {estimate.feesGeneratedAt ? ` · fees generated ${formatIsoDate(estimate.feesGeneratedAt.slice(0, 10))}` : ''}.{' '}
              {selected ? (
                <>
                  This estimate is <span className="font-semibold text-nurture">Selected for file</span>: the 1003, Overview, Prequal and letters read it.
                </>
              ) : (
                'A Draft: editing it never changes the file until you select it.'
              )}
            </p>
          </Card>
          {holdForFile && (
            <div className="rounded-xl border-2 border-primary bg-card p-3 shadow-soft">
              <p className="text-sm font-semibold">Update the file too?</p>
              <p className="mt-1 text-xs text-muted-foreground">You changed the selected estimate. Its numbers are on the 1003, Overview and letters.</p>
              <Button className="mt-3 w-full" size="sm" disabled={answering} onClick={updateFile}>
                Yes, update the file
              </Button>
              <Button className="mt-2 w-full" size="sm" variant="outline" disabled={answering} onClick={saveAsDraft}>
                No, save as a new draft
              </Button>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          <section id="estimate-step-1" className="scroll-mt-28">
            <Card
              title="1 · Program & pricing"
              description="Lender quote for this estimate"
              action={
                <Button size="sm" variant="link" onClick={onCompare}>
                  Compare estimates
                  <ArrowRightIcon />
                </Button>
              }
            >
              <FormGrid className="lg:grid-cols-4">
                <Input label="Estimate name" value={draft.name} onChange={set('name')} required span={2} />
                <Select
                  label="Lender"
                  value={lenderId}
                  options={lenderOptions}
                  onChange={pickLender}
                  onClear={() => pickLender(null)}
                  placeholder={draft.lenderName ?? (lenders.isLoading ? 'Loading…' : 'Pick a lender')}
                />
                <Select
                  label="Program"
                  value={programId}
                  options={programOptions}
                  onChange={(id) => void pickProgram(id)}
                  onClear={() => void pickProgram(null)}
                  placeholder={lenderId ? (programOptions.length ? 'Pick a program' : 'No programs for this lender') : (draft.programName ?? 'Pick a lender first')}
                />
                <Select label="Loan type" value={draft.mortgageType} options={MORTGAGE_TYPE_OPTIONS} onChange={set('mortgageType')} onClear={() => set('mortgageType')(null)} />
                <PercentInput label="Rate" value={draft.noteRate} onChange={set('noteRate')} required />
                <PercentInput label="Points / credit" value={draft.pointsPct} onChange={(v) => set('pointsPct')(v ?? 0)} hint={draft.pointsPct < 0 ? `${formatCurrency(r.lenderCredit - draft.lenderCredit)} credit` : draft.pointsPct > 0 ? `${formatCurrency(pointsAmount(draft.pointsPct, f.totalLoanAmount))} in points` : 'Negative = credit'} />
                <CurrencyInput label="Lender credit ($)" value={draft.lenderCredit} onChange={(v) => set('lenderCredit')(v ?? 0)} />
                <NumberInput label="Lock" suffix="days" value={draft.lockDays} onChange={set('lockDays')} maxDecimals={0} />
                <DateInput label="Quote date" value={draft.quoteDate} onChange={set('quoteDate')} />
                <Select label="Term" value={draft.termMonths ? String(draft.termMonths) : null} options={TERM_OPTIONS} onChange={(v) => set('termMonths')(Number(v))} />
                <DateInput label="Closing / funding" value={draft.estimatedFundingDate} onChange={set('estimatedFundingDate')} hint={draft.estimatedFundingDate ? `${prepaidInterestDays(draft.estimatedFundingDate)} days of interest` : 'Sets prepaid interest'} />
                {isPurchase && <CurrencyInput label="Purchase price" value={draft.purchasePrice} onChange={(v) => setDraft((d) => ({ ...d, purchasePrice: v, ...(d.propertyValue === d.purchasePrice && { propertyValue: v }) }))} required />}
                {isPurchase ? (
                  <>
                    <PercentInput
                      label="Down payment %"
                      value={draft.purchasePrice && draft.loanAmount != null ? round(pct(draft.purchasePrice - draft.loanAmount, draft.purchasePrice) ?? 0, 3) : null}
                      onChange={(v) => draft.purchasePrice && set('loanAmount')(round(draft.purchasePrice * (1 - (v ?? 0) / 100), 0))}
                    />
                    <CurrencyInput label="Down payment $" value={f.downPayment} onChange={(v) => draft.purchasePrice && set('loanAmount')(round(draft.purchasePrice - (v ?? 0), 2))} />
                  </>
                ) : (
                  <CurrencyInput label="Loan amount" value={draft.loanAmount} onChange={set('loanAmount')} required />
                )}
                <CurrencyInput label={isPurchase ? 'Appraised value' : 'Value'} value={draft.propertyValue} onChange={set('propertyValue')} hint={isPurchase ? 'Blank = the price' : undefined} />
                <Input label={isPurchase ? 'Base loan / LTV' : 'LTV'} value={`${isPurchase ? `${formatCurrency(f.baseLoanAmount)} · ` : ''}${formatPercent(f.ltvPct, 2)}`} readOnly />
                <Select
                  label="Property"
                  value={draft.propertyId}
                  options={data.properties.map((p) => ({ value: p.id, label: p.addressLine }))}
                  onChange={set('propertyId')}
                  onClear={() => set('propertyId')(null)}
                  placeholder="No property (TBD)"
                  span={2}
                />
                <div className="flex items-end pb-1">
                  <ToggleChip label="Interest only" pressed={draft.interestOnly} onChange={set('interestOnly')} />
                </div>
                <TextArea label="Notes" value={draft.notes ?? ''} onChange={(v) => set('notes')(v || null)} rows={2} span={4} />
              </FormGrid>
              {mortgagee && (
                <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                  <span className="font-semibold">Mortgagee clause ({lender}):</span> <span className="whitespace-pre-line">{mortgagee}</span>
                </p>
              )}
            </Card>
          </section>

          <section id="estimate-step-2" className="scroll-mt-28">
            <ReviewFees<EstimateDraft>
              title="2 · Smart Fees"
              description={`Built from ${[purposeLabel(loan.purpose), draft.mortgageType?.toUpperCase().replace('_RURAL', ''), facts.property?.county ? `${facts.property.county} County${facts.property.state ? `, ${facts.property.state}` : ''}` : null, isPurchase && draft.purchasePrice ? `price ${formatCurrency(draft.purchasePrice)}` : null, `base loan ${formatCurrency(f.baseLoanAmount)}`, lender, draft.estimatedFundingDate ? `funds ${formatIsoDate(draft.estimatedFundingDate)}` : null].filter(Boolean).join(' · ')}. Type over a fee to change it for this estimate.`}
              action={
                <>
                  <Button size="sm" variant="outline" onClick={resetAll} disabled={!overrides.length}>
                    <RotateCcwIcon />
                    Reset all
                  </Button>
                  <Button size="sm" className="bg-money text-white hover:bg-money/90" onClick={regenerate}>
                    <SparklesIcon />
                    Regenerate fees
                  </Button>
                </>
              }
              purpose={loan.purpose}
              draft={draft}
              setDraft={setDraft}
              sources={new Map(r.priced.lines.filter((l) => l.source).map((l) => [l.key, l.source!]))}
              onSaveFee={saveFee}
              onResetFee={resetFee}
              lines={r.priced.lines}
              totals={r.priced.totals}
              overrides={overrides}
              closingCosts={r.priced.closingCosts}
              lenderCredit={r.lenderCredit}
              totalLoanAmount={f.totalLoanAmount}
              noFeeList={data.noFeeList && !draft.feeRules?.length}
            />
          </section>
        </div>

        <div className="min-w-0 space-y-4 lg:col-start-2 xl:col-start-3 xl:row-start-1">
          <section id="estimate-step-3" className="scroll-mt-28">
            <Card title="3 · Monthly payment & credits" description="One place for all of it">
              <dl className="divide-y text-sm">
                <PayLine label="Principal & interest" value={f.principalAndInterest} />
                <PayLine label={`Property taxes${facts.property?.county ? ` · ${facts.property.county} Co.` : ''}`} value={f.taxes}>
                  <CurrencyInput label="Property taxes per year" hideLabel value={draft.taxesFactor === 'annual' ? draft.taxesValue : round(f.taxes * 12)} onChange={(v) => setDraft((d) => ({ ...d, taxesValue: v, taxesFactor: 'annual' }))} placeholder="per year" />
                </PayLine>
                <PayLine label="Homeowner's insurance" value={f.hoi}>
                  <CurrencyInput label="Insurance per year" hideLabel value={draft.insuranceFactor === 'annual' ? draft.insuranceValue : round(f.hoi * 12)} onChange={(v) => setDraft((d) => ({ ...d, insuranceValue: v, insuranceFactor: 'annual' }))} placeholder="per year" />
                </PayLine>
                <PayLine label="Mortgage insurance" value={f.mi}>
                  {draft.monthlyMi == null ? (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => set('monthlyMi')(f.mi)}>
                      Calculated · type over
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <CurrencyInput label="Mortgage insurance per month" hideLabel value={draft.monthlyMi} onChange={(v) => set('monthlyMi')(v ?? 0)} />
                      <Button size="icon-sm" variant="ghost" title="Back to calculated" onClick={() => set('monthlyMi')(null)}>
                        <RotateCcwIcon />
                      </Button>
                    </div>
                  )}
                </PayLine>
                <PayLine label="HOA" value={f.hoa}>
                  <CurrencyInput label="HOA per month" hideLabel value={draft.monthlyHoa} onChange={set('monthlyHoa')} placeholder="per month" />
                </PayLine>
                {r.dpaMonthly > 0 && <PayLine label="DPA payment" value={r.dpaMonthly} />}
                <PayLine label={draft.otherPaymentLabel || 'Other'} value={round(f.otherMonthly - r.dpaMonthly)}>
                  <CurrencyInput label="Other per month" hideLabel value={draft.otherPaymentMonthly} onChange={set('otherPaymentMonthly')} placeholder="per month" />
                </PayLine>
              </dl>
              <PaymentBar parts={[f.principalAndInterest, f.taxes + f.hoi, f.mi, f.hoa + f.otherMonthly]} />
              <div className="mt-3 flex items-baseline justify-between border-t pt-3">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-semibold text-money tabular-nums">{formatCurrency(f.pitia)}</span>
              </div>
              <p className="mt-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Credits</p>
              <FormGrid className="mt-1 lg:grid-cols-2">
                {isPurchase && <CurrencyInput label="Seller credit" value={draft.sellerCredits} onChange={set('sellerCredits')} placeholder={formatCurrency(facts.sellerCredits)} hint={draft.sellerCredits == null ? 'From the loan' : 'This estimate only'} />}
                {isPurchase && <CurrencyInput label="Earnest money" value={draft.earnestMoney} onChange={set('earnestMoney')} placeholder={formatCurrency(facts.earnestMoney)} hint={draft.earnestMoney == null ? 'From the 1003' : 'This estimate only'} />}
                <Input label="Lender credit" value={formatCurrency(r.lenderCredit)} readOnly hint="Set in Program & pricing" />
                <Input label="Gifts (1003)" value={formatCurrency(round(facts.assets.filter((a) => a.type === 'gift_cash' || a.type === 'grant').reduce((s, a) => s + a.amount, 0)))} readOnly />
              </FormGrid>
              {isPurchase && draft.dpa !== undefined && <DpaFields value={draft.dpa ?? null} onChange={(dpa) => setDraft((d) => ({ ...d, dpa }))} monthly={r.dpaMonthly} cltvPct={r.cltvPct} />}
            </Card>
          </section>

          <section id="estimate-step-4" className="scroll-mt-28">
            <Card title="4 · Cash to close & funds">
              <dl className="divide-y text-sm">
                {isPurchase ? <Line label={`Down payment (${formatPercent(draft.purchasePrice ? pct(f.downPayment, draft.purchasePrice) : null, 2)})`} value={f.downPayment} /> : <Line label="Mortgage payoffs" value={r.cash.mortgagePayoffs} />}
                <Line label="Closing costs" value={r.cash.closingCosts} />
                {r.cash.debtsPaidAtClosing > 0 && <Line label="Debts paid at closing" value={r.cash.debtsPaidAtClosing} />}
                {!isPurchase && <Line label="New loan" value={-r.cash.loanProceeds} />}
                {r.cash.sellerCredits > 0 && <Line label="Seller credit" value={-r.cash.sellerCredits} />}
                {r.cash.lenderCredit > 0 && <Line label="Lender credit" value={-r.cash.lenderCredit} />}
                {r.cash.earnestMoney > 0 && <Line label="Earnest money" value={-r.cash.earnestMoney} />}
                {r.dpaAmount > 0 && <Line label={draft.dpa?.kind === 'gift' ? 'Gift / grant' : 'Down payment assistance'} value={-r.dpaAmount} />}
                {r.cash.otherCredits - r.dpaAmount > 0 && <Line label="Gift of equity / other credits" value={-round(r.cash.otherCredits - r.dpaAmount)} />}
              </dl>
              <div className="mt-2 flex items-baseline justify-between border-t pt-3">
                <span className="font-semibold">{r.cash.label}</span>
                <span className="text-lg font-semibold text-money tabular-nums">{formatCurrency(Math.abs(r.cash.cashToClose))}</span>
              </div>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt>Available funds</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(f.availableFunds)}</dd>
                </div>
                <dd className="text-xs text-muted-foreground">
                  {facts.assets.filter((a) => a.type !== 'earnest_money').length ? facts.assets.filter((a) => a.type !== 'earnest_money').map((a) => `${a.type.replace(/_/g, ' ')} ${formatCurrency(a.amount)}`).join(' · ') : 'No assets on the 1003 yet'}
                </dd>
                <div className="flex justify-between pt-1">
                  <dt>Left after closing</dt>
                  <dd className={cn('font-semibold tabular-nums', f.fundsLeft < 0 ? 'text-destructive' : 'text-nurture')}>
                    {formatCurrency(f.fundsLeft)}
                    {f.reservesMonths != null && ` · ${f.reservesMonths} mo`}
                  </dd>
                </div>
                {r.cash.fromOwnFunds !== Math.max(r.cash.cashToClose, 0) && <dd className="text-xs text-muted-foreground">{formatCurrency(r.cash.fromOwnFunds)} from the borrower's own funds after gifts</dd>}
                <div className="flex justify-between pt-1">
                  <dt>DTI with this payment</dt>
                  <dd className="font-semibold tabular-nums">{f.dtiFront != null ? `${formatPercent(f.dtiFront, 1)} / ${formatPercent(f.dtiBack, 1)}` : '—'}</dd>
                </div>
              </dl>
              {data.application.liabilities.filter((l) => l.unpaidBalance).length > 0 && (
                <div className="mt-3 space-y-2">
                  {data.application.liabilities
                    .filter((l) => l.unpaidBalance)
                    .map((l) => {
                      const on = facts.debts.find((d) => d.id === l.id)?.toBePaidOff ?? l.toBePaidOff
                      return (
                        <div key={l.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {l.creditorName ?? 'Debt'} · {formatCurrency(l.unpaidBalance)}
                            </p>
                            <p className="text-xs text-muted-foreground">{on ? `Paid at closing → ${formatCurrency(l.monthlyPayment)}/mo out of DTI` : `${formatCurrency(l.monthlyPayment)}/mo counts in DTI`}</p>
                          </div>
                          <ToggleChip label={on ? 'Paying off' : 'Pay off'} pressed={on} onChange={(v) => togglePayoff(l.id, v)} />
                        </div>
                      )
                    })}
                  <p className="text-[11px] text-muted-foreground">Paying off a debt changes it on the 1003, so every estimate on this file uses it.</p>
                </div>
              )}
            </Card>
          </section>

          <section id="estimate-step-5" className="scroll-mt-28">
            <Card
              title="5 · Loan Estimate"
              description="Uses this estimate's numbers"
              action={
                <Button size="sm" onClick={savePdf} disabled={pdf.saving || !pdf.ready}>
                  <FileTextIcon />
                  {pdf.saving ? 'Making PDF…' : 'Download PDF'}
                </Button>
              }
            >
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="rounded-md border bg-card p-3 shadow-soft">
                  <p className="text-sm font-semibold">MPS Mortgage · Loan Estimate</p>
                  <p className="text-xs text-muted-foreground">
                    {joinNames(borrowerNames) || 'Borrower'} · {[estimateProgramName({ ...estimate, ...draft }), formatPercent(draft.noteRate)].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 w-4/5 rounded bg-muted" />
                    <div className="h-1.5 w-3/5 rounded bg-muted" />
                    <div className="h-1.5 w-2/3 rounded bg-muted" />
                  </div>
                  <p className="mt-3 text-xs">
                    Est. payment {formatCurrency(f.pitia)} · {r.cash.label} {formatCurrency(Math.abs(f.cashToClose))}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground italic">Estimate. Final figures come from the lender's Loan Estimate.</p>
                </div>
              </div>
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, hint, money, warn }: { label: string; value: string; hint?: string; money?: boolean; warn?: boolean }) {
  return (
    <div className="border-r border-b px-3 py-1 last:border-r-0 lg:border-b-0">
      <p className="truncate text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn('text-[0.95rem] leading-tight font-semibold tabular-nums', money && 'text-money', warn && 'text-destructive')}>{value}</p>
      {hint && <p className={cn('truncate text-[0.65rem]', money && !warn ? 'text-money' : 'text-muted-foreground')}>{hint}</p>}
    </div>
  )
}

function PayLine({ label, value, children }: { label: string; value: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <dt className="min-w-0 flex-1 truncate">{label}</dt>
      {children && <dd className="w-28 shrink-0">{children}</dd>}
      <dd className="w-20 shrink-0 text-right font-semibold tabular-nums">{value ? formatCurrency(value) : '—'}</dd>
    </div>
  )
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-1.5">
      <dt>{label}</dt>
      <dd className={cn('font-semibold tabular-nums', value < 0 && 'text-nurture')}>{value < 0 ? `−${formatCurrency(-value)}` : formatCurrency(value)}</dd>
    </div>
  )
}

const BAR_COLORS = ['bg-primary', 'bg-money', 'bg-sky-300', 'bg-nurture']

function PaymentBar({ parts }: { parts: number[] }) {
  const total = parts.reduce((s, x) => s + x, 0)
  if (total <= 0) return null
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
      {parts.map((p, i) => (p > 0 ? <div key={i} className={BAR_COLORS[i]} style={{ width: `${(p / total) * 100}%` }} /> : null))}
    </div>
  )
}

/** After a save: keep what was typed meanwhile, take the saved results and the fee rules and facts frozen on the first save. */
function withSaved(d: EstimateDraft, ready: EstimateDraft): EstimateDraft {
  return { ...d, figures: ready.figures, pricedAt: ready.pricedAt, feeRules: d.feeRules ?? ready.feeRules, loanSnapshot: d.loanSnapshot ?? ready.loanSnapshot, feesGeneratedAt: d.feesGeneratedAt ?? ready.feesGeneratedAt }
}
