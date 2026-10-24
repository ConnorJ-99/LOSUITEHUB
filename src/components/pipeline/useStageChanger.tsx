import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useUpdateStage } from '@/lib/api/loans'
import { LOST_REASONS, stageLabel, type PipelineStage } from '@/lib/pipeline/stages'

interface PendingLost {
  loanId: string
  borrowerName: string
}

/**
 * Shared stage-change logic for the board, list and record page. Moving to
 * Lost first asks for a reason (the database requires one); every other
 * stage saves immediately. Render `dialog` once in the calling component.
 */
export function useStageChanger() {
  const updateStage = useUpdateStage()
  const [pendingLost, setPendingLost] = useState<PendingLost | null>(null)
  const [reason, setReason] = useState('')

  const save = (loanId: string, stage: PipelineStage, lostReason?: string) => {
    updateStage.mutate(
      { loanId, stage, lostReason },
      {
        onSuccess: () => toast.success(`Moved to ${stageLabel(stage)}`),
        onError: (error) => toast.error(`Could not change stage: ${error.message}`),
      },
    )
  }

  const requestChange = (loan: { id: string; stage: PipelineStage; borrowerName: string }, stage: PipelineStage) => {
    if (stage === loan.stage) return
    if (stage === 'lost') {
      setReason('')
      setPendingLost({ loanId: loan.id, borrowerName: loan.borrowerName })
      return
    }
    save(loan.id, stage)
  }

  const confirmLost = () => {
    if (!pendingLost || !reason.trim()) return
    save(pendingLost.loanId, 'lost', reason.trim())
    setPendingLost(null)
  }

  const dialog = (
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
  )

  return { requestChange, dialog, isSaving: updateStage.isPending }
}
