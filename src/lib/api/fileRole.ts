import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { db } from './client'
import { filePermissions, fileRoleFor, type FileRole } from '@/lib/auth/fileRole'
import { useLoanFile } from './loanfile'
import { useLoan } from './loans'

/**
 * Your role on this file ('admin', 'lo', 'processor' or null) and what it
 * allows, from the file and its team (both already loaded on the file page).
 * Null while they load. The database checks the same rule (file_role()).
 */
export function useFileRole(loanId: string) {
  const { state } = useAuth()
  const loan = useLoan(loanId)
  const file = useLoanFile(loanId)
  const user = state.status === 'signedIn' ? state.user : null
  const ready = !!loan.data && !!file.data && !!user
  const role: FileRole | null = ready
    ? fileRoleFor({ userId: user!.id, companyRole: user!.role, assignedLoId: loan.data!.assignedLo?.id ?? null, teamProfileIds: file.data!.team.map((t) => t.profileId) })
    : null
  return { role, ready, ...filePermissions(role), loName: loan.data?.assignedLo?.name ?? null }
}

export interface ProcessingFile {
  loanId: string
  borrowerName: string
  stage: string
  purpose: string
  loName: string | null
}

/** Files you're the processor on and aren't the loan officer of (the pipeline's Processing view and Today). */
export function useProcessingFiles() {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: ['processingFiles', me],
    enabled: !!me,
    queryFn: async (): Promise<ProcessingFile[]> => {
      const r = await db()
        .from('loan_team_members')
        .select(
          'loan:loans!loan_team_members_loan_id_fkey ( id, stage, purpose, assigned_lo_id, lo:profiles!loans_assigned_lo_id_fkey ( full_name, email ), borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) ) )',
        )
        .eq('profile_id', me!)
        .eq('role', 'processor')
      if (r.error) throw new Error(r.error.message)
      type Row = { loan: { id: string; stage: string; purpose: string; assigned_lo_id: string | null; lo: { full_name: string | null; email: string } | null; borrowers: { role: string; contact: { first_name: string; last_name: string } | null }[] } | null }
      return ((r.data ?? []) as unknown as Row[]).flatMap(({ loan }) => {
        if (!loan || loan.assigned_lo_id === me) return []
        const primary = (loan.borrowers.find((b) => b.role === 'primary') ?? loan.borrowers[0])?.contact
        return [{ loanId: loan.id, borrowerName: primary ? `${primary.first_name} ${primary.last_name}`.trim() : 'No borrower', stage: loan.stage, purpose: loan.purpose, loName: loan.lo ? loan.lo.full_name || loan.lo.email : null }]
      })
    },
  })
}

/** Just your role on a file, from the database (for lists like the Action Queue, without loading each file). */
export function useFileRoleOnly(loanId: string) {
  return useQuery({
    queryKey: ['fileRole', loanId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FileRole | null> => {
      const r = await db().rpc('file_role', { loan: loanId })
      // Before the file roles script has run there are no file roles: treat it as yours.
      return r.error ? 'lo' : ((r.data as FileRole | null) ?? null)
    },
  })
}
