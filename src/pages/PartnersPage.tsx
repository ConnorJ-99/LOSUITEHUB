import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDownIcon, ChevronRightIcon, HandshakeIcon, MailIcon, PencilIcon, PhoneIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, EmptyState, PageHeader, SearchInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { TONE_CLASS } from '@/components/messages/tone'
import { PartnerDialog } from '@/components/partners/PartnerDialog'
import { useDeletePartner, usePartners, type Partner } from '@/lib/api/partners'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate } from '@/lib/dates'
import { consentChip } from '@/lib/messaging/thread'
import { PARTNER_KINDS, partnerKindLabel, searchPartners, splitFiles, type PartnerKind } from '@/lib/partners/match'
import { formatPhone } from '@/lib/pipeline/helpers'
import { stageLabel } from '@/lib/pipeline/stages'

const ROLE_LABEL: Record<string, string> = {
  buyer_agent: "Buyer's agent",
  listing_agent: 'Listing agent',
  title: 'Title',
  escrow_officer: 'Escrow officer',
}

const ADDED_FROM: Record<Partner['addedFrom'], string> = {
  file_team: "Added from a file's team",
  website: 'Added from the website partner form',
  manual: 'Added by hand',
}

function ConsentChips({ partner }: { partner: Partner }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['text', 'email'] as const).map((channel) => {
        const chip = channel === 'text' ? consentChip('text', partner.smsConsent, partner.smsOptedOutAt) : consentChip('email', partner.emailConsent, partner.emailOptedOutAt)
        const label = chip.label === 'Consent not recorded' ? `${channel === 'text' ? 'Text' : 'Email'} consent not recorded` : chip.label
        return (
          <span key={channel} className={TONE_CLASS[chip.tone]}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function FileLine({ file }: { file: Partner['files'][number] }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-sm">
      <Link to={`/loans/${file.loanId}`} className="font-medium text-primary underline-offset-2 hover:underline">
        {file.borrowerName}
      </Link>
      <span className="text-xs text-muted-foreground">
        {[ROLE_LABEL[file.role] ?? file.role, stageLabel(file.stage), file.closingDate && `${file.stage === 'closed' ? 'closed' : 'closing'} ${formatIsoDate(file.closingDate)}`].filter(Boolean).join(' · ')}
      </span>
    </li>
  )
}

function PartnerCard({ partner, canEdit, onEdit }: { partner: Partner; canEdit: boolean; onEdit: () => void }) {
  const remove = useDeletePartner()
  const [showClosed, setShowClosed] = useState(false)
  const { open, closed } = splitFiles(partner.files)

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-semibold">{partner.name}</p>
            <p className="text-sm text-muted-foreground">{[partnerKindLabel(partner.kind), partner.company].filter(Boolean).join(' · ')}</p>
          </div>
          {canEdit && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={onEdit}>
                <PencilIcon />
                Edit
              </Button>
              {partner.files.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={remove.isPending}
                  title="Delete this partner"
                  onClick={async () => {
                    const ok = await confirmAction(`Delete ${partner.name} from the Partner center? They're on no files you can see. This can't be undone.`, { confirmLabel: 'Delete partner', destructive: true })
                    if (!ok) return
                    remove.mutate(partner.id, { onSuccess: () => toast.success(`${partner.name} deleted`), onError: (e) => toast.error(e.message) })
                  }}
                >
                  <Trash2Icon />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:gap-x-4">
          {partner.email ? (
            <a href={`mailto:${partner.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all hover:underline">
              <MailIcon className="size-3.5 shrink-0 text-muted-foreground" />
              {partner.email}
            </a>
          ) : (
            <span className="text-muted-foreground">No email</span>
          )}
          {partner.phone ? (
            <a href={`tel:${partner.phone}`} className="inline-flex items-center gap-1.5 font-mono hover:underline">
              <PhoneIcon className="size-3.5 text-muted-foreground" />
              {formatPhone(partner.phone)}
            </a>
          ) : (
            <span className="text-muted-foreground">No phone</span>
          )}
        </div>
        <ConsentChips partner={partner} />

        <div className="border-t pt-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Open files · {open.length}</p>
          {open.length ? (
            <ul className="divide-y">
              {open.map((f) => (
                <FileLine key={`${f.loanId}:${f.role}`} file={f} />
              ))}
            </ul>
          ) : (
            <p className="py-1.5 text-sm text-muted-foreground">None right now.</p>
          )}
          {closed.length > 0 && (
            <>
              <button type="button" onClick={() => setShowClosed((s) => !s)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
                {showClosed ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                Closed and lost · {closed.length}
              </button>
              {showClosed && (
                <ul className="divide-y">
                  {closed.map((f) => (
                    <FileLine key={`${f.loanId}:${f.role}`} file={f} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {partner.notes && <p className="text-sm whitespace-pre-line">{partner.notes}</p>}
        <p className="text-xs text-muted-foreground">
          {ADDED_FROM[partner.addedFrom]} {formatIsoDate(partner.createdAt.slice(0, 10))}
          {partner.lastInquiryAt && ` · last website inquiry ${formatIsoDate(partner.lastInquiryAt.slice(0, 10))}`}
        </p>
      </div>
    </Card>
  )
}

/** Realtors, title, builders and referral partners, with the files each is on. */
export function PartnersPage() {
  const partners = usePartners()
  const { state } = useAuth()
  const canEdit = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin' || state.user.role === 'loan_officer')
  // ?q= opens the list already searched (Today's "View partner").
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [kind, setKind] = useState<PartnerKind | null>(null)
  const [editing, setEditing] = useState<Partner | 'new' | null>(null)

  const all = useMemo(() => partners.data ?? [], [partners.data])
  const rows = useMemo(() => searchPartners(all, search).filter((p) => !kind || p.kind === kind), [all, search, kind])
  const counts = (k: PartnerKind) => all.filter((p) => p.kind === k).length

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Partner center"
        description={partners.data ? `${all.length} ${all.length === 1 ? 'partner' : 'partners'}: realtors, title, builders and referral partners. People on a file's team are added here automatically.` : undefined}
        action={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon />
              Add partner
            </Button>
          ) : undefined
        }
      />

      {partners.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {partners.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load partners" description={partners.error.message} />
        </Card>
      )}

      {partners.isSuccess && (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SearchInput value={search} onChange={setSearch} placeholder="Name, company, email or phone" className="w-full sm:w-80" />
            <ToggleChipGroup>
              <ToggleChip label={`All · ${all.length}`} pressed={kind === null} onChange={() => setKind(null)} />
              {PARTNER_KINDS.filter((k) => counts(k.value) > 0).map((k) => (
                <ToggleChip key={k.value} label={`${k.plural} · ${counts(k.value)}`} pressed={kind === k.value} onChange={(p) => setKind(p ? k.value : null)} />
              ))}
            </ToggleChipGroup>
          </div>

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={HandshakeIcon}
                title={all.length ? 'No partners match' : 'No partners yet'}
                description={all.length ? 'Try a different search.' : "Agents and title contacts you put on a file's team show up here, and so do website partner forms."}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {rows.map((p) => (
                <PartnerCard key={p.id} partner={p} canEdit={canEdit} onEdit={() => setEditing(p)} />
              ))}
            </div>
          )}
        </>
      )}

      {editing && <PartnerDialog partner={editing === 'new' ? null : editing} partners={all} onClose={() => setEditing(null)} />}
    </>
  )
}
