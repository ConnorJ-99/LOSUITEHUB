import { describe, expect, it } from 'vitest'
import { filePermissions, fileRoleFor } from './fileRole'

const JANE = 'jane'
const CONNOR = 'connor'

describe('fileRoleFor', () => {
  it('a loan officer processing another LO\'s file is its processor', () => {
    expect(fileRoleFor({ userId: JANE, companyRole: 'loan_officer', assignedLoId: CONNOR, teamProfileIds: [JANE] })).toBe('processor')
  })
  it('on her own file she is the loan officer, even if also in the processor slot', () => {
    expect(fileRoleFor({ userId: JANE, companyRole: 'loan_officer', assignedLoId: JANE, teamProfileIds: [JANE] })).toBe('lo')
  })
  it('the Admin login is admin on every file', () => {
    expect(fileRoleFor({ userId: 'a', companyRole: 'admin', assignedLoId: CONNOR, teamProfileIds: [] })).toBe('admin')
  })
  it('an owner is not admin on files that are not theirs', () => {
    expect(fileRoleFor({ userId: CONNOR, companyRole: 'owner', assignedLoId: JANE, teamProfileIds: [CONNOR] })).toBe('processor')
    expect(fileRoleFor({ userId: CONNOR, companyRole: 'owner', assignedLoId: JANE, teamProfileIds: [] })).toBeNull()
  })
  it('a processor-only hire is processor on the files they are on', () => {
    expect(fileRoleFor({ userId: 'p', companyRole: 'processor', assignedLoId: CONNOR, teamProfileIds: ['p'] })).toBe('processor')
  })
  it('the file LO Assistant is loa, not processor', () => {
    expect(fileRoleFor({ userId: JANE, companyRole: 'loan_officer', assignedLoId: CONNOR, teamProfileIds: [JANE], loaProfileIds: [JANE] })).toBe('loa')
    expect(filePermissions('loa')).toEqual({ manageFile: false, seeComp: false, sendMessages: false, moveStage: false })
  })
  it('no one signed in has no role', () => {
    expect(fileRoleFor({ userId: null, companyRole: null, assignedLoId: CONNOR, teamProfileIds: [] })).toBeNull()
  })
})

describe('filePermissions', () => {
  it('a processor works the file but does not run it', () => {
    expect(filePermissions('processor')).toEqual({ manageFile: false, seeComp: false, sendMessages: false, moveStage: true })
  })
  it('the loan officer and admin run it', () => {
    expect(filePermissions('lo')).toEqual({ manageFile: true, seeComp: true, sendMessages: true, moveStage: true })
    expect(filePermissions('admin')).toEqual({ manageFile: true, seeComp: true, sendMessages: true, moveStage: true })
  })
})
