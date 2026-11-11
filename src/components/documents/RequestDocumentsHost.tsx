import { useSyncExternalStore } from 'react'
import type { LoanProfile } from '@/lib/api/types'
import { RequestDocumentsDialog } from './RequestDocumentsDialog'

// One "Request documents" panel per loan page, opened from the Documents tab,
// a condition's "Request docs" (its items pre-linked) or the header's menu.

type Open = { loanId: string; conditionId: string | null } | null
let current: Open = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Opens the Request documents panel on this file, optionally pre-linked to a condition. */
export function openRequestDocuments(loanId: string, conditionId: string | null = null) {
  current = { loanId, conditionId }
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
      key={`${open.loanId}:${open.conditionId ?? ''}`}
      loan={loan}
      conditionId={open.conditionId}
      onClose={() => {
        current = null
        emit()
      }}
    />
  )
}
