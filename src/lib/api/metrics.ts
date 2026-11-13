// Every file the signed-in person can see, slimmed down for the Business
// metrics page (leads and active clients). RLS decides what that is: the
// Admin login sees every file, everyone else their own.
import { useQuery } from '@tanstack/react-query'
import type { PipelineLoan } from '@/lib/metrics/business'
import { db, unwrap } from './client'

interface Row {
  id: string
  created_at: string
  stage: string
  import_key: string | null
  assigned_lo_id: string | null
  lead_source_type: 'company' | 'self' | null
  lo: { full_name: string | null; email: string } | null
  borrowers: { role: string; contact_id: string }[]
}

export function useMetricsFiles() {
  return useQuery({
    queryKey: ['metricsFiles'],
    queryFn: async (): Promise<{ files: PipelineLoan[]; names: Map<string, string> }> => {
      const rows = unwrap<Row[]>(
        await db()
          .from('loans')
          .select('id, created_at, stage, import_key, assigned_lo_id, lead_source_type, lo:profiles!loans_assigned_lo_id_fkey ( full_name, email ), borrowers:loan_borrowers ( role, contact_id )')
          .limit(20000),
      )
      const names = new Map<string, string>()
      for (const r of rows) if (r.assigned_lo_id && r.lo) names.set(r.assigned_lo_id, r.lo.full_name || r.lo.email)
      return {
        names,
        files: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          stage: r.stage,
          imported: !!r.import_key,
          loId: r.assigned_lo_id,
          leadSource: r.lead_source_type,
          contactId: (r.borrowers.find((b) => b.role === 'primary') ?? r.borrowers[0])?.contact_id ?? null,
        })),
      }
    },
  })
}
