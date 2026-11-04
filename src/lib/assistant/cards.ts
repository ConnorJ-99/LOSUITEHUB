// What the assistant shows under a reply (Loan Officer Assistant). Saved
// with each chat message (assistant_chat_messages.cards), so they come back
// when the chat is reopened.

export type AssistantCard =
  | { type: 'borrowers'; title: string; items: { loanId: string; name: string; detail: string }[] }
  | { type: 'choices'; question: string; options: { label: string; loanId: string }[] }
  | { type: 'summary'; loanId: string; name: string; status: string; lines: { label: string; value: string }[] }
  | {
      type: 'estimates'
      loanId: string
      items: { id: string; name: string; lender: string | null; program: string | null; rate: number | null; points: number | null; loanAmount: number | null; pi: number | null; taxes: number | null; payment: number | null; cashToClose: number | null; selected: boolean }[]
    }

export const isCard = (v: unknown): v is AssistantCard =>
  typeof v === 'object' && v !== null && ['borrowers', 'choices', 'summary', 'estimates'].includes((v as { type?: unknown }).type as string)
