import { describe, expect, it } from 'vitest'
import { cardAmount, columnFor, columnTotals, pipelineFor, PIPELINES, purposePipeline, stageLabelFor, type PipelineFile } from './pipelines'
import { PURPOSES, STAGES, type LoanPurpose, type PipelineStage } from './stages'
import { statusDetailChoices, statusDetailOptions } from './statusDetail'
import { timelineChoice, TIMELINE_OPTIONS } from './timeline'

const now = new Date('2026-10-27T17:00:00Z')
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000 - 60_000).toISOString()
const file = (purpose: LoanPurpose, stage: PipelineStage, days = 1): PipelineFile => ({ purpose, stage, stageChangedAt: ago(days) })

describe('stages match the database', () => {
  it('Home Search sits between Pre-Approved and Under Contract', async () => {
    const scripts = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts).join('\n')
    const created = /create type public\.pipeline_stage as enum \(([^)]*)\)/.exec(sql)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1))
    const added = [...sql.matchAll(/alter type public\.pipeline_stage add value if not exists '([a-z_]+)' after '([a-z_]+)'/g)]
    const db = [...created]
    for (const [, value, after] of added) db.splice(db.indexOf(after) + 1, 0, value)
    expect(STAGES.map((s) => s.value)).toEqual(db)
  })
})

describe('which pipeline a file shows in', () => {
  it('every loan type has a pipeline while the file is active', () => {
    expect(PURPOSES.map((p) => purposePipeline(p.value))).toEqual(['purchase', 'refinance', 'refinance', 'heloc', 'heloc', 'investment'])
  })
  it('new leads, then the loan type, then In Process', () => {
    expect(pipelineFor(file('heloc', 'lead'), now)).toBe('new_leads')
    expect(pipelineFor(file('purchase', 'home_search'), now)).toBe('purchase')
    expect(pipelineFor(file('refinance_cash_out', 'processing'), now)).toBe('in_process')
    expect(pipelineFor(file('purchase', 'clear_to_close'), now)).toBe('in_process')
  })
  it('closed files stay in In Process for 30 days', () => {
    expect(pipelineFor(file('purchase', 'closed', 30), now)).toBe('in_process')
    expect(pipelineFor(file('purchase', 'closed', 31), now)).toBeNull()
  })
  it('Nurture and Lost stay in their own pipeline for 6 days, move on day 7', () => {
    expect(pipelineFor(file('purchase', 'nurture', 6), now)).toBe('purchase')
    expect(columnFor(file('purchase', 'nurture', 6), 'purchase')?.id).toBe('out')
    expect(pipelineFor(file('purchase', 'nurture', 7), now)).toBe('nurture')
    expect(pipelineFor(file('refinance_rate_term', 'lost', 0), now)).toBe('refinance')
    expect(pipelineFor(file('refinance_rate_term', 'lost', 8), now)).toBe('lost')
  })
  it('every file that shows in a pipeline has exactly one column there', () => {
    for (const p of PURPOSES)
      for (const s of STAGES) {
        const f = file(p.value, s.value, 2)
        const where = pipelineFor(f, now)
        if (where) expect(columnFor(f, where), `${p.value} ${s.value}`).not.toBeNull()
      }
  })
  it('no stage is in two columns of one pipeline, and drops go to a stage the column shows', () => {
    for (const p of PIPELINES) {
      const stages = p.columns.flatMap((c) => c.stages)
      expect(new Set(stages).size, p.id).toBe(stages.length)
      for (const c of p.columns) if (c.dropStage) expect(c.stages).toContain(c.dropStage)
    }
  })
})

describe('columns and totals', () => {
  it('Purchase keeps Pre-Approved and adds Home Search; refinances end at Application', () => {
    expect(PIPELINES.find((p) => p.id === 'purchase')!.columns.map((c) => c.label)).toEqual(['Contacted', 'Pre-Qualified', 'Pre-Approved', 'Home Search', 'Under Contract', 'Nurture / Lost this week'])
    expect(PIPELINES.find((p) => p.id === 'refinance')!.columns.map((c) => c.label)).toEqual(['Contacted', 'Pre-Qualified', 'Application', 'Nurture / Lost this week'])
    expect(stageLabelFor('under_contract', 'refinance_cash_out', 'Under Contract')).toBe('Application')
    expect(stageLabelFor('under_contract', 'purchase', 'Under Contract')).toBe('Under Contract')
  })
  it('cards show the loan amount, else the price; columns add them up', () => {
    expect(cardAmount({ loanAmount: 380000, purchasePrice: 400000 })).toBe(380000)
    expect(cardAmount({ loanAmount: null, purchasePrice: 400000 })).toBe(400000)
    expect(cardAmount({ loanAmount: null, purchasePrice: null })).toBeNull()
    const files = [
      { ...file('purchase', 'contacted'), loanAmount: 150000, purchasePrice: null },
      { ...file('purchase', 'contacted'), loanAmount: null, purchasePrice: 192000 },
      { ...file('purchase', 'pre_qualified'), loanAmount: null, purchasePrice: null },
      { ...file('refinance_rate_term', 'contacted'), loanAmount: 999999, purchasePrice: null },
    ]
    expect(columnTotals(files, 'purchase', now).slice(0, 2)).toEqual([
      { column: 'contacted', count: 2, total: 342000 },
      { column: 'pre_qualified', count: 1, total: 0 },
    ])
  })
})

describe('status detail and timeline', () => {
  it('choices fit the stage and loan type', () => {
    expect(statusDetailChoices('contacted', 'purchase')).toEqual(['Reviewing credit', 'Waiting on documents', 'Application sent', 'Left voicemail', 'Needs follow-up'])
    expect(statusDetailChoices('under_contract', 'refinance_rate_term')).not.toContain('Option period')
    expect(statusDetailChoices('home_search', 'purchase')).toContain('Just started looking')
  })
  it('a detail that is not on the list still shows', () => {
    expect(statusDetailOptions('contacted', 'purchase', 'Waiting on spouse').at(-1)).toBe('Waiting on spouse')
    expect(statusDetailOptions('contacted', 'purchase', 'Reviewing credit')).toHaveLength(5)
  })
  it('timelines typed elsewhere map to the dropdown when they can', () => {
    expect(TIMELINE_OPTIONS).toContain('3–6 months')
    expect(timelineChoice('3 months')).toBe('3 months')
    expect(timelineChoice('asap')).toBe('ASAP')
    expect(timelineChoice('3-6 months')).toBe('3–6 months')
    expect(timelineChoice('90 days')).toBe('3 months')
    expect(timelineChoice('after the lease ends in June')).toBe('other')
    expect(timelineChoice('  ')).toBeNull()
  })
})
