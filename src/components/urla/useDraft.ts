import { useState } from 'react'

/**
 * Local copy of saved values for a form, with change tracking. `dirty` is
 * true once anything differs from what's saved.
 */
export function useDraft<T extends object>(saved: T) {
  const [form, setForm] = useState<T>(saved)
  const set = <K extends keyof T>(key: K) => (value: T[K]) => setForm((f) => ({ ...f, [key]: value }))
  const changes = Object.fromEntries(
    Object.entries(form).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof T])),
  ) as Partial<T>
  return { form, set, setForm, changes, dirty: Object.keys(changes).length > 0, reset: () => setForm(saved) }
}
