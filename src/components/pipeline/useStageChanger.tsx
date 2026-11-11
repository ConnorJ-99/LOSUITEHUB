import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, FormGrid, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useGhlOpportunity } from '@/components/messaging/useGhlOpportunity'
import { db, unwrap } from '@/lib/api/client'
import { useCloseLoan, useUpdateStage } from '@/lib/api/loans'
import { todayIso } from '@/lib/dates'
import { LOST_REASONS, stageLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { milestoneForStage } from '@/lib/messaging/updates'
import { offerMilestoneUpdate } from '@/components/messaging/fileTextRequests'

interface Pending {
  loanId: string
  borrowerName: string
}

/**
 * Shared stage-change logic for the board, list and record page. Moving to
 * Lost first asks for a reason (the database requires one). Moving to Closed
 * first asks for the Closed on and Funded on dates (production counts on the
 * funding date), saved with the stage in one step; then the borrower's GHL
 * opportunity moves to Closed / Recently Closed, once, on the stage change
 * only. Every other stage saves immediately. Render `dialog` once in the
 * calling component.
 */
export function useStageChanger() {
  const updateStage = useUpdateStage()
  const closeLoan = useCloseLoan()
  const ghl = useGhlOpportunity()
  const [pendingLost, setPendingLost] = useState<Pending | null>(null)
  const [reason, setReason] = useState('')
  const [pendingClosed, setPendingClosed] = useState<Pending | null>(null)
  const [closedOn, setClosedOn] = useState<string | null>(null)
  const [fundedOn, setFundedOn] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const save = (loanId: string, stage: PipelineStage, lostReason?: string) => {
    updateStage.mutate(
      { loanId, stage, lostReason },
      {
        onSuccess: () => {
          toast.success(`Moved to ${stageLabel(stage)}`)
          // With underwriting, approved, clear to close: offer the borrower and realtor update texts.
          const milestone = milestoneForStage(stage)
          if (milestone) void offerMilestoneUpdate(loanId, milestone)
        },
        onError: (error) => toast.error(`Could not change stage: ${error.message}`),
      },
    )
  }

  const requestChange = async (loan: { id: string; stage: PipelineStage; borrowerName: string; closingDate?: string | null }, stage: PipelineStage) => {
    if (stage === loan.stage) return
    if (stage === 'lost') {
      setReason('')
      setPendingLost({ loanId: loan.id, borrowerName: loan.borrowerName })
      return
    }
    if (stage === 'closed') {
      // Both dates start at the file's closing date if it has one, else today.
      let closing = loan.closingDate
      if (closing === undefined) closing = (unwrap<{ closing_date: string | null } | null>(await db().from('loans').select('closing_date').eq('id', loan.id).maybeSingle()))?.closing_date ?? null
      const start = closing ?? todayIso()
      setClosedOn(start)
      setFundedOn(start)
      setNote('')
      setPendingClosed({ loanId: loan.id, borrowerName: loan.borrowerName })
      return
    }
    save(loan.id, stage)
  }

  const confirmLost = () => {
    if (!pendingLost || !reason.trim()) return
    save(pendingLost.loanId, 'lost', reason.trim())
    setPendingLost(null)
  }

  const fundedBeforeClosed = !!closedOn && !!fundedOn && fundedOn < closedOn
  const confirmClosed = () => {
    if (!pendingClosed || !closedOn || !fundedOn || fundedBeforeClosed) return
    const { loanId, borrowerName } = pendingClosed
    closeLoan.mutate(
      { loanId, closingDate: closedOn, fundingDate: fundedOn, reason: note.trim() || null },
      {
        onSuccess: () => {
          toast.success('Moved to Closed')
          setPendingClosed(null)
          void ghl.move(loanId, 'closed', borrowerName)
          void offerMilestoneUpdate(loanId, 'closed')
        },
        onError: (error) => toast.error(`Could not mark closed: ${error.message}`),
      },
    )
  }

  const dialog = (
    <>
      <Dialog open={pendingLost !== null} onOpenChange={(open) => !open && setPendingLost(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Lost</DialogTitle>
            <DialogDescription>Why didn't {pendingLost?.borrowerName ?? 'this loan'} move forward?</DialogDescription>
          </DialogHeader>
          <ToggleChipGroup>
            {LOST_REASONS.map((r) => (
              <ToggleChip key={r} label={r} pressed={reason === r} onChange={(pressed) => setReason(pressed ? r : '')} />
            ))}
          </ToggleChipGroup>
          <TextArea label="Reason" value={reason} onChange={setReason} required rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLost(null)}>
              Cancel
            </Button>
            <Button onClick={confirmLost} disabled={!reason.trim()}>
              Mark as Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingClosed !== null} onOpenChange={(open) => !open && !closeLoan.isPending && setPendingClosed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Closed</DialogTitle>
            <DialogDescription>When did {pendingClosed?.borrowerName ?? 'this loan'} close and fund? Production counts on the funded date.</DialogDescription>
          </DialogHeader>
          <FormGrid className="lg:grid-cols-2">
            <DateInput label="Closed on" value={closedOn} onChange={setClosedOn} required />
            <DateInput label="Funded on" value={fundedOn} onChange={setFundedOn} required error={fundedBeforeClosed ? "Can't be before the closed date" : undefined} />
            <TextArea label="Reason / note (optional)" value={note} onChange={setNote} rows={2} span={2} placeholder="e.g. Funded Friday, marked closed Monday" />
          </FormGrid>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingClosed(null)} disabled={closeLoan.isPending}>
              Cancel
            </Button>
            <Button onClick={confirmClosed} disabled={!closedOn || !fundedOn || fundedBeforeClosed || closeLoan.isPending}>
              {closeLoan.isPending ? 'Saving…' : 'Mark as Closed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { requestChange, dialog, isSaving: updateStage.isPending || closeLoan.isPending }
}
