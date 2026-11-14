import { db, unwrap } from '@/lib/api/client'
import { linkGhlPartner } from '@/lib/api/ghl'
import { borrowerIntro, milestoneUpdate, MILESTONE_LABEL, partnerIntro, type Milestone, type UpdateFacts } from '@/lib/messaging/updates'
import { openFileTexts } from './FileTextsHost'

/** What the texts say about the file: its LO (name, personal cell), borrower, address and closing date. */
async function fileFacts(loanId: string): Promise<UpdateFacts & { personalCell: string | null }> {
  const r = unwrap<{
    closing_date: string | null
    lo: { full_name: string | null; email: string; personal_cell: string | null } | null
    borrowers: { role: string; contact: { first_name: string } | null }[]
    home: { address_line: string } | null
  }>(
    await db()
      .from('loans')
      .select('closing_date, lo:profiles!loans_assigned_lo_id_fkey ( full_name, email, personal_cell ), borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name ) ), home:properties!loans_subject_property_id_fkey ( address_line )')
      .eq('id', loanId)
      .single(),
  )
  const primary = (r.borrowers.find((b) => b.role === 'primary') ?? r.borrowers[0])?.contact
  return { loName: r.lo?.full_name || r.lo?.email || null, personalCell: r.lo?.personal_cell ?? null, borrowerFirst: primary?.first_name ?? null, address: r.home?.address_line ?? null, closingDate: r.closing_date }
}

/** After a borrower is added to GoHighLevel: the intro text, from the LO's work number. */
export async function offerBorrowerIntro(loanId: string, contactId: string) {
  const f = await fileFacts(loanId).catch(() => null)
  // A file you can no longer see (handed to another LO): no box.
  if (!f) return
  openFileTexts({
    loanId,
    title: 'Intro text',
    description: "They're in GoHighLevel now. Send them your work number, with your personal cell for anything else. Edit it first if you like.",
    build: (r) => (r.kind === 'borrower' && r.id === contactId ? borrowerIntro({ borrowerFirst: r.name, loName: f.loName, personalCell: f.personalCell }) : null),
  })
}

/** After a realtor or other partner joins a file's team: their intro text. */
export async function offerPartnerIntro(loanId: string, partnerId: string) {
  const f = await fileFacts(loanId).catch(() => null)
  // A file you can no longer see (handed to another LO): no box.
  if (!f) return
  openFileTexts({
    loanId,
    title: 'Intro text',
    description: 'Introduce yourself to them. They get loan updates from your work number. Edit it first if you like.',
    build: (r) => (r.kind === 'partner' && r.id === partnerId ? partnerIntro({ partnerName: r.name, loName: f.loName, borrowerFirst: f.borrowerFirst, address: f.address, personalCell: f.personalCell }) : null),
  })
}

/** After a milestone (a stage, a workflow step, a closing date): an update for the borrowers and the realtors on the file. */
export async function offerMilestoneUpdate(loanId: string, milestone: Milestone) {
  const f = await fileFacts(loanId).catch(() => null)
  // A file you can no longer see (handed to another LO): no box.
  if (!f) return
  openFileTexts({
    loanId,
    title: milestone === 'other' ? 'Send an update' : `Update: ${MILESTONE_LABEL[milestone]}`,
    description: 'Let the borrower and the realtors know. Realtors only ever get the milestone and dates, never loan figures.',
    build: (r) => milestoneUpdate(milestone, { kind: r.kind, name: r.name }, f),
    // Realtors start ticked; title and other partners only when you tick them.
    preselect: (r) => r.kind === 'borrower' || /agent/i.test(r.role),
  })
}

/**
 * A partner just joined a file's team: add them to GoHighLevel if they aren't
 * there yet (matched to their existing contact, never a duplicate), then offer
 * the intro text (not for Gmail partners: title and insurance). A GHL problem doesn't stop the intro; the send links them too.
 */
export async function afterPartnerJoined(organizationId: string, loanId: string, partnerId: string) {
  // Title and insurance partners who email through Gmail stay out of GoHighLevel and get no text.
  const p = await db().from('partners').select('*').eq('id', partnerId).maybeSingle()
  if ((p.data as { email_via_gmail?: boolean } | null)?.email_via_gmail) return
  try {
    await linkGhlPartner(organizationId, partnerId)
  } catch {
    // GHL not set up or not reachable: the intro box still opens.
  }
  await offerPartnerIntro(loanId, partnerId)
}
