// What the assistant shows under a reply (Loan Officer Assistant). Saved
// with each chat message (assistant_chat_messages.cards), so they come back
// when the chat is reopened. A card for an in-app change carries its
// assistant_actions id (actionId), so its Undo works later too.

export interface EstimateItem {
  id: string
  name: string
  lender: string | null
  program: string | null
  rate: number | null
  points: number | null
  loanAmount: number | null
  pi: number | null
  taxes: number | null
  payment: number | null
  cashToClose: number | null
  selected: boolean
}

export type AssistantCard =
  | { type: 'borrowers'; title: string; items: { loanId: string; name: string; detail: string }[] }
  | { type: 'choices'; question: string; options: { label: string; loanId: string }[] }
  | { type: 'summary'; loanId: string; name: string; status: string; lines: { label: string; value: string }[] }
  | { type: 'estimates'; loanId: string; items: EstimateItem[]; created?: boolean; note?: string; actionId?: string }
  | {
      type: 'change'
      title: string
      loanId: string
      lines: { label: string; before: string; after: string }[]
      footnote?: string
      /** Next steps offered as chips (each sends that sentence to the assistant). */
      suggestions: string[]
      actionId?: string
    }

export const isCard = (v: unknown): v is AssistantCard =>
  typeof v === 'object' && v !== null && ['borrowers', 'choices', 'summary', 'estimates', 'change'].includes((v as { type?: unknown }).type as string)
