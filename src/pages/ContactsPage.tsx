import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PlusIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, DataTable, EmptyState, PageHeader, SearchInput } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { useContacts } from '@/lib/api/contacts'
import { emptyFilters, formatPhone, fullName, matchesFilters } from '@/lib/pipeline/helpers'

const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Everyone in LOSuite: leads, clients and past clients, one row per person. */
export function ContactsPage() {
  const contacts = useContacts()
  const navigate = useNavigate()
  const { openNewLead } = useNewLead()
  const [search, setSearch] = useState('')

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
        description={contacts.data ? `${contacts.data.length} ${contacts.data.length === 1 ? 'person' : 'people'}` : undefined}
        action={<Button onClick={() => openNewLead()}><PlusIcon />New Lead</Button>}
      />

      {contacts.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {contacts.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load contacts" description={contacts.error.message} />
        </Card>
      )}

      {contacts.isSuccess && (
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
                      <p className="text-xs text-muted-foreground md:hidden">{formatPhone(c.phone) || c.email}</p>
                    </div>
                  ),
                },
                { key: 'phone', header: 'Phone', cell: (c) => formatPhone(c.phone) || '—', hideOnMobile: true },
                { key: 'email', header: 'Email', cell: (c) => c.email ?? '—', hideOnMobile: true },
                { key: 'loans', header: 'Loans', cell: (c) => c.loans.length, align: 'right', hideOnMobile: true },
                { key: 'latest', header: 'Latest stage', cell: (c) => (c.loans[0] ? <StageBadge stage={c.loans[0].stage} /> : '—') },
                { key: 'added', header: 'Added', cell: (c) => dateOnly.format(new Date(c.createdAt)), align: 'right', hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}
    </>
  )
}
