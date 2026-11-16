import { describe, expect, it } from 'vitest'
import { customObstacle, daysInNurture, followUpOverdue, NURTURE_STAGES, OBSTACLE_GROUPS, obstacleGroup, obstacleLabel, obstacleSummary } from './obstacles'

describe('nurture obstacles', () => {
  it('has the keys the database accepts', () => {
    const scripts = import.meta.glob<string>('/supabase/migrations/*_nurture.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts).join(' ')
    expect(sql).toContain('nurture_obstacle_ok')
    for (const g of OBSTACLE_GROUPS) for (const i of g.items) expect(sql).toContain(`'${i.key}'`)
    for (const s of NURTURE_STAGES) expect(sql).toContain(`'${s.id}'`)
  })

  it('names obstacles, typed ones too', () => {
    expect(obstacleLabel('debt_dti_high')).toBe('DTI too high')
    expect(customObstacle('  finish   probation  ')).toBe('custom:finish probation')
    expect(customObstacle('   ')).toBeNull()
    expect(obstacleLabel('custom:finish probation')).toBe('finish probation')
    expect(obstacleGroup('custom:x')).toBe('other')
    expect(obstacleGroup('credit_errors')).toBe('credit')
    expect(obstacleSummary(['credit_score_low', 'other_lease'])).toBe('Score below program minimum, Lease expiring')
  })

  it('counts days and spots overdue follow-ups', () => {
    expect(daysInNurture('2026-11-01T12:00:00Z', new Date('2026-11-16T12:00:00Z'))).toBe(15)
    expect(daysInNurture(null, new Date())).toBeNull()
    expect(followUpOverdue('2026-11-15', '2026-11-16')).toBe(true)
    expect(followUpOverdue('2026-11-16', '2026-11-16')).toBe(false)
    expect(followUpOverdue(null, '2026-11-16')).toBe(false)
  })
})
