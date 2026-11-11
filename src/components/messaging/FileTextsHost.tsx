import { useSyncExternalStore } from 'react'
import { FileTextsDialog, type FileTextsRequest } from './FileTextsDialog'

// One intro / update box for the whole app: any screen asks for it with
// openFileTexts(), and FileTextsHost (rendered once in the app shell) shows it.

let current: FileTextsRequest | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openFileTexts(request: FileTextsRequest) {
  current = request
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function FileTextsHost() {
  const request = useSyncExternalStore(subscribe, () => current)
  if (!request) return null
  return (
    <FileTextsDialog
      key={`${request.loanId}:${request.title}`}
      request={request}
      onClose={() => {
        current = null
        emit()
      }}
    />
  )
}
