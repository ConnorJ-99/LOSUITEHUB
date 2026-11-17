import { useSyncExternalStore } from 'react'
import type { LoanProfile } from '@/lib/api/types'
import type { PickedItem } from '@/lib/documents/uploadRequests'
import { RequestDocumentsDialog } from './RequestDocumentsDialog'

// One "Request documents" panel per loan page, opened from Docs & Conditions
// ("Send upload link" with the ticked conditions as its items), a condition's
// "Request docs" (its items pre-linked) or the header's menu.

type Open = { loanId: string; conditionId: string | null; items?: PickedItem[]; contactId?: string | null; n: number } | null
let current: Open = null
let opened = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Opens the Request documents panel on this file, optionally pre-linked to a condition, or started with these items for this borrower. */
export function openRequestDocuments(loanId: string, conditionId: string | null = null, start?: { items: PickedItem[]; contactId: string | null }) {
  current = { loanId, conditionId, items: start?.items, contactId: start?.contactId ?? null, n: ++opened }
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function RequestDocumentsHost({ loan }: { loan: LoanProfile }) {
  const open = useSyncExternalStore(subscribe, () => current)
  if (!open || open.loanId !== loan.id) return null
  return (
    <RequestDocumentsDialog
      key={open.n}
      loan={loan}
      conditionId={open.conditionId}
      initialItems={open.items}
      initialContactId={open.contactId ?? null}
      onClose={() => {
        current = null
        emit()
      }}
    />
  )
}
