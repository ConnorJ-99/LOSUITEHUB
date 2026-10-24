import { useState } from 'react'
import { InboxIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CurrencyInput,
  DataTable,
  EmptyState,
  FormGrid,
  Input,
  PageHeader,
  PercentInput,
  Select,
  SummaryBar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleChip,
  ToggleChipGroup,
} from '@/components/shared'
import { cltv, dti, ltv, piti, qualifyingValue } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'

const termOptions = [
  { value: '360', label: '30 year fixed' },
  { value: '300', label: '25 year fixed' },
  { value: '240', label: '20 year fixed' },
  { value: '180', label: '15 year fixed' },
] as const

const occupancyOptions = [
  { value: 'primary', label: 'Primary residence' },
  { value: 'second', label: 'Second home' },
  { value: 'investment', label: 'Investment' },
] as const

const sampleRows = [
  { id: '1', name: 'Sample Borrower', stage: 'Pre-Approved', purpose: 'Purchase', amount: 380_000 },
  { id: '2', name: 'Example Client', stage: 'Lead', purpose: 'Cash-Out Refi', amount: 250_000 },
]

/**
 * Living reference for the shared components, wired to the calc library so
 * the numbers can be sanity-checked by hand. Not a real product screen.
 */
export function ComponentLibraryPage() {
  const [borrowerName, setBorrowerName] = useState('Sample Borrower')
  const [purchasePrice, setPurchasePrice] = useState<number | null>(400_000)
  const [appraisedValue, setAppraisedValue] = useState<number | null>(400_000)
  const [loanAmount, setLoanAmount] = useState<number | null>(380_000)
  const [secondLien, setSecondLien] = useState<number | null>(null)
  const [rate, setRate] = useState<number | null>(6.5)
  const [term, setTerm] = useState<(typeof termOptions)[number]['value']>('360')
  const [occupancy, setOccupancy] = useState<(typeof occupancyOptions)[number]['value'] | null>('primary')
  const [annualTaxes, setAnnualTaxes] = useState<number | null>(9_600)
  const [annualInsurance, setAnnualInsurance] = useState<number | null>(2_400)
  const [monthlyHoa, setMonthlyHoa] = useState<number | null>(50)
  const [monthlyIncome, setMonthlyIncome] = useState<number | null>(11_000)
  const [otherDebts, setOtherDebts] = useState<number | null>(650)
  const [flags, setFlags] = useState({ selfEmployed: false, fthb: true, itin: false, nonOccupant: false })

  const value = qualifyingValue(appraisedValue ?? 0, purchasePrice ?? undefined)
  const loanLtv = ltv(loanAmount ?? 0, value)
  const loanCltv = cltv([loanAmount ?? 0, secondLien ?? 0], value)
  const payment = piti({
    principal: loanAmount ?? 0,
    annualRatePct: rate ?? 0,
    termMonths: Number(term),
    annualTaxes: annualTaxes ?? 0,
    annualInsurance: annualInsurance ?? 0,
    monthlyHoa: monthlyHoa ?? 0,
  })
  const ratios = dti(payment.total, otherDebts ?? 0, monthlyIncome ?? 0)

  const toggle = (key: keyof typeof flags) => (pressed: boolean) => setFlags((f) => ({ ...f, [key]: pressed }))

  return (
    <>
      <PageHeader
        title="Component Library"
        description="Every shared building block in one place. Numbers come from the tested calc library."
      />

      <div className="space-y-4">
        <Card title="Sample scenario form" description="6-column grid, required fields marked *, calculated fields greyed out.">
          <FormGrid>
            <Input label="Borrower name" value={borrowerName} onChange={setBorrowerName} required span={2} />
            <Select label="Occupancy" value={occupancy} onChange={setOccupancy} options={occupancyOptions} required span={2} />
            <Select label="Product / term" value={term} onChange={setTerm} options={termOptions} span={2} />

            <CurrencyInput label="Purchase price" value={purchasePrice} onChange={setPurchasePrice} required />
            <CurrencyInput label="Appraised value" value={appraisedValue} onChange={setAppraisedValue} />
            <CurrencyInput label="Loan amount" value={loanAmount} onChange={setLoanAmount} required />
            <CurrencyInput label="2nd lien amount" value={secondLien} onChange={setSecondLien} />
            <PercentInput label="LTV" value={loanLtv} readOnly hint="Calculated" />
            <PercentInput label="CLTV" value={loanCltv} readOnly hint="Calculated" />

            <PercentInput label="Note rate" value={rate} onChange={setRate} required />
            <CurrencyInput label="Annual taxes" value={annualTaxes} onChange={setAnnualTaxes} />
            <CurrencyInput label="Annual insurance" value={annualInsurance} onChange={setAnnualInsurance} />
            <CurrencyInput label="Monthly HOA" value={monthlyHoa} onChange={setMonthlyHoa} />
            <CurrencyInput label="Gross monthly income" value={monthlyIncome} onChange={setMonthlyIncome} />
            <CurrencyInput label="Other monthly debts" value={otherDebts} onChange={setOtherDebts} />
          </FormGrid>

          <div className="mt-5 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Borrower flags</p>
            <ToggleChipGroup>
              <ToggleChip label="Self-employed" pressed={flags.selfEmployed} onChange={toggle('selfEmployed')} />
              <ToggleChip label="First-time homebuyer" pressed={flags.fthb} onChange={toggle('fthb')} />
              <ToggleChip label="ITIN" pressed={flags.itin} onChange={toggle('itin')} />
              <ToggleChip label="Non-occupant co-borrower" pressed={flags.nonOccupant} onChange={toggle('nonOccupant')} />
            </ToggleChipGroup>
          </div>
        </Card>

        <Card title="Tabs, table and empty state">
          <Tabs defaultValue="table">
            <TabsList>
              <TabsTrigger value="table">Data table</TabsTrigger>
              <TabsTrigger value="empty">Empty state</TabsTrigger>
            </TabsList>
            <TabsContent value="table" className="pt-3">
              <DataTable
                columns={[
                  { key: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
                  { key: 'stage', header: 'Stage', cell: (r) => <Badge variant="secondary">{r.stage}</Badge> },
                  { key: 'purpose', header: 'Purpose', cell: (r) => r.purpose, hideOnMobile: true },
                  { key: 'amount', header: 'Loan amount', cell: (r) => formatCurrency(r.amount), align: 'right' },
                ]}
                rows={sampleRows}
                rowKey={(r) => r.id}
                onRowClick={(r) => toast(`Clicked ${r.name}`)}
              />
            </TabsContent>
            <TabsContent value="empty" className="pt-3">
              <EmptyState
                icon={InboxIcon}
                title="No properties yet"
                description="Add a home the borrower is interested in."
                action={<Button variant="outline" size="sm">Add property</Button>}
              />
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      <SummaryBar
        items={[
          { label: 'Loan amount', value: formatCurrency(loanAmount) },
          { label: 'LTV', value: formatPercent(loanLtv) },
          { label: 'CLTV', value: formatPercent(loanCltv) },
          { label: 'PITI', value: formatCurrency(payment.total) },
          { label: 'Front DTI', value: formatPercent(ratios.front) },
          { label: 'Back DTI', value: formatPercent(ratios.back), warning: (ratios.back ?? 0) > 50 },
        ]}
        action={<Button onClick={() => toast('Saving arrives with the real loan screens.')}>Save scenario</Button>}
      />
    </>
  )
}
