import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { FileUpIcon, PlusIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DataTable, EmptyState, PageHeader, SearchInput } from '@/components/shared'
import { ClosedLoansTab } from '@/components/closed/ClosedLoansTab'
import { ImportClientsDialog } from '@/components/closed/ImportClientsDialog'
import { useNewLead } from '@/components/leads/new-lead-context'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { useContacts } from '@/lib/api/contacts'
import { useAuth } from '@/lib/auth/context'
import { emptyFilters, formatPhone, fullName, matchesFilters } from '@/lib/pipeline/helpers'

const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Everyone in LOSuite: leads, clients and past clients, one row per person; and the closed loans. */
export function ContactsPage() {
  const contacts = useContacts()
  const navigate = useNavigate()
  const { state } = useAuth()
  const { openNewLead } = useNewLead()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [importing, setImporting] = useState(false)
  const tab = params.get('tab') === 'closed' ? 'closed' : 'everyone'
  const canImport = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin' || state.user.role === 'loan_officer')

  const rows = useMemo(
    () =>
      (contacts.data ?? []).filter((c) =>
        matchesFilters(
          { stage: 'lead', purpose: 'purchase', assignedLoId: null, referralSource: null, borrower: c },
          { ...emptyFilters, search },
        ),
      ),
    [contacts.data, search],
  )

  return (
    <>
      <PageHeader
        title="Contacts"
        description={tab === 'closed' ? 'Closed loans and production' : contacts.data ? `${contacts.data.length} ${contacts.data.length === 1 ? 'person' : 'people'}` : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {canImport && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUpIcon />
                Import CSV
              </Button>
            )}
            <Button onClick={() => openNewLead()}><PlusIcon />New Lead</Button>
          </div>
        }
      />

      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {[
          { id: 'everyone', label: 'Everyone' },
          { id: 'closed', label: 'Closed loans' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'closed' ? { tab: 'closed' } : {}, { replace: true })}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'closed' && <ClosedLoansTab />}

      {tab === 'everyone' && contacts.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {tab === 'everyone' && contacts.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load contacts" description={contacts.error.message} />
        </Card>
      )}

      {tab === 'everyone' && contacts.isSuccess && (
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="Name, phone or email" className="mb-4 w-full sm:w-72" />
          <Card contentClassName="px-0 md:px-(--card-spacing)">
            <DataTable
              rows={rows}
              rowKey={(c) => c.id}
              onRowClick={(c) => c.loans[0] && navigate(`/loans/${c.loans[0].id}`)}
              empty={{
                icon: UsersIcon,
                title: search ? 'No one matches' : 'No contacts yet',
                description: search ? 'Try a different search.' : 'People you add as leads appear here.',
              }}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  cell: (c) => (
                    <div>
                      <p className="font-medium">{fullName(c)}</p>
                      <p className="font-mono text-xs text-muted-foreground md:hidden">{formatPhone(c.phone) || c.email}</p>
                    </div>
                  ),
                },
                { key: 'phone', header: 'Phone', cell: (c) => <span className="font-mono">{formatPhone(c.phone) || '—'}</span>, hideOnMobile: true },
                { key: 'email', header: 'Email', cell: (c) => c.email ?? '—', hideOnMobile: true },
                { key: 'loans', header: 'Loans', cell: (c) => c.loans.length, align: 'right', hideOnMobile: true },
                { key: 'latest', header: 'Latest stage', cell: (c) => (c.loans[0] ? <StageBadge stage={c.loans[0].stage} /> : '—') },
                { key: 'added', header: 'Added', cell: (c) => dateOnly.format(new Date(c.createdAt)), align: 'right', hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}

      {importing && <ImportClientsDialog open onOpenChange={setImporting} />}
    </>
  )
}
