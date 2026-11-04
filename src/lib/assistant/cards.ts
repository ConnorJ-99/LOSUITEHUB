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
  | { type: 'estimates'; loanId: string; items: EstimateItem[]; created?: boolean; note?: string; actionId?: string; forName?: string }
  | {
      /** A message the assistant drafted. Nothing goes out until Send on the card. */
      type: 'message'
      loanId: string
      contactId: string
      name: string
      channel: 'text' | 'email'
      subject: string | null
      body: string
      /** Fee Estimates to attach as PDFs (email only). */
      estimates: { id: string; name: string }[]
      /** A short text after the email, with no link. */
      headsUp: string | null
      actionId?: string
    }
  | {
      /** A message to many clients. Nothing goes out until "Send to N clients" on the card. */
      type: 'bulk'
      channel: 'text' | 'email'
      segmentLabel: string
      subject: string | null
      /** With {first name} filled per person at send time. */
      body: string
      recipients: { contactId: string; loanId: string; name: string; firstName: string }[]
      excluded: { name: string; reason: 'opted_out' | 'no_consent' | 'no_ghl_contact' | 'no_phone' | 'no_email' }[]
      actionId?: string
    }
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
  typeof v === 'object' && v !== null && ['borrowers', 'choices', 'summary', 'estimates', 'change', 'message', 'bulk'].includes((v as { type?: unknown }).type as string)
