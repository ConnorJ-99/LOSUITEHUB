import { Card, PageHeader } from '@/components/shared'
import { AssistantChat } from '@/components/assistant/AssistantChat'

/** The Assistant page: jobs across every file you can see (lists, lookups, finding a borrower). */
export function AssistantPage() {
  return (
    <>
      <PageHeader eyebrow="Workspace" title="Assistant" description="Ask about any of your files, or name a borrower. Fee Estimates, stage changes and messages come in later updates." />
      <Card className="h-[calc(100dvh-13rem)] min-h-[28rem] gap-0 overflow-hidden py-0" contentClassName="flex min-h-0 flex-1 flex-col px-0">
        <AssistantChat loanId={null} borrowerName={null} className="flex-1" />
      </Card>
    </>
  )
}
