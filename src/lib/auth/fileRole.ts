// Your role on one file (Connor, 2026-11-16). Company roles still run the
// company-wide pages (Settings, Lenders, admin pages); on a file, what you can
// do follows your role on that file. Same rule as file_role() in
// 20270208000000_file_roles.sql, which the database enforces.

import type { OrgRole } from './context'

export type FileRole = 'admin' | 'lo' | 'processor'

export interface FileRoleFacts {
  userId: string | null
  companyRole: OrgRole | null
  assignedLoId: string | null
  /** Company users on the file's team (loan_team_members.profile_id). */
  teamProfileIds: (string | null)[]
}

/** 'admin' (sees every file), 'lo' (the assigned loan officer), 'processor' (on the team, not the LO), else null. */
export function fileRoleFor(f: FileRoleFacts): FileRole | null {
  if (!f.userId || !f.companyRole) return null
  if (f.companyRole === 'admin') return 'admin'
  if (f.assignedLoId === f.userId) return 'lo'
  if (f.teamProfileIds.includes(f.userId)) return 'processor'
  return null
}

/** What a role may do on the file. Anything not listed is open to everyone who can see the file. */
export function filePermissions(role: FileRole | null) {
  const runs = role === 'lo' || role === 'admin'
  return {
    /** Change the loan officer, move to Lost or Closed, delete the file. */
    manageFile: runs,
    /** See and edit revenue and comp. */
    seeComp: runs,
    /** Approve and send messages (others draft them for the loan officer). */
    sendMessages: runs,
  }
}
