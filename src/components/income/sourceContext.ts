// The sources the worksheet card hands to the source chips under its figures (Stage 4d-2).
import { createContext } from 'react'
import type { InputSource, InputSources } from '@/lib/income/fromDocuments'

export interface SourceContextValue {
  sources: InputSources
  inputs: unknown
  onOpen?: (s: InputSource) => void
}

export const SourceContext = createContext<SourceContextValue | null>(null)
