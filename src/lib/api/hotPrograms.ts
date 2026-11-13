// Hot programs per qualifying type (Connor, 2026-11-13; `20270120000000_hot_for.sql`,
// rules in src/lib/products/hot.ts): set on the Lenders page ("Hot for"
// chips on each program); Match lenders shows the programs Hot for the
// scenario's type and Build estimates lists Hot programs first. Read on their
// own, so every screen keeps working before the script has run (then nothing
// is hot and the chips are hidden).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HotKey } from '@/lib/products/hot'
import { db, unwrap } from './client'

const hotKey = ['hotPrograms'] as const

/** Program id → the types it's Hot for (only programs Hot for something); `ready` is false until the script has run. */
export function useHotPrograms() {
  return useQuery({
    queryKey: hotKey,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ ready: boolean; hotFor: Map<string, HotKey[]> }> => {
      const r = await db().from('programs').select('id, hot_for').neq('hot_for', '{}')
      if (r.error) return { ready: false, hotFor: new Map() }
      return { ready: true, hotFor: new Map((r.data as { id: string; hot_for: HotKey[] }[]).map((p) => [p.id, p.hot_for])) }
    },
  })
}

/** Sets the types a program is Hot for (owners and admins, like any catalog edit). */
export function useSetHotFor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { programId: string; hotFor: HotKey[] }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('programs').update({ hot_for: v.hotFor }).eq('id', v.programId).select('id'))
      if (!rows.length) throw new Error('Only owners and admins can change Hot programs.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: hotKey }),
  })
}
