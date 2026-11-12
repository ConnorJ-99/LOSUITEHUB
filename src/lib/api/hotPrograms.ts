// Hot programs (Connor, 2026-11-12; `20270117000000_hot_programs.sql`): the
// programs to look at first. Match lenders shows only these by default and
// Build estimates lists them first. Read on their own, so every screen keeps
// working before the script has run (then nothing is hot and the star is hidden).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, unwrap } from './client'

const hotKey = ['hotPrograms'] as const

/** The ids of Hot programs; `ready` is false until the hot programs script has run. */
export function useHotPrograms() {
  return useQuery({
    queryKey: hotKey,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ ready: boolean; ids: Set<string> }> => {
      const r = await db().from('programs').select('id').eq('is_hot', true)
      if (r.error) return { ready: false, ids: new Set() }
      return { ready: true, ids: new Set((r.data as { id: string }[]).map((p) => p.id)) }
    },
  })
}

/** Stars or un-stars a program (owners and admins, like any catalog edit). */
export function useSetHot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { programId: string; hot: boolean }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('programs').update({ is_hot: v.hot }).eq('id', v.programId).select('id'))
      if (!rows.length) throw new Error('Only owners and admins can change Hot programs.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: hotKey }),
  })
}
