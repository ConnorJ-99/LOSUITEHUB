import { describe, expect, it } from 'vitest'
import { checkClientFile, COLUMNS, importTotals, parseDate, parseRate, parseTermMonths, reportCsv, templateCsv } from './clients'
import { parseCsv, toCsv } from './csv'

const today = new Date('2026-10-29T12:00:00')
const file = (header: string[], ...rows: string[][]) => toCsv([header, ...rows])

describe('parseCsv / toCsv', () => {
  it('reads quotes, commas and line breaks inside a cell, CRLF and a byte-order mark', () => {
    const text = '﻿a,b,c\r\n"1, 2","say ""hi""","line\nbreak"\r\n\r\nx,,z'
    expect(parseCsv(text)).toEqual([['a', 'b', 'c'], ['1, 2', 'say "hi"', 'line\nbreak'], ['x', '', 'z']])
  })

  it('writes cells that read back the same', () => {
    const rows = [['a,b', 'q"uote', ' padded', 'plain']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('values', () => {
  it('reads dates in the usual export formats and refuses impossible ones', () => {
    expect(parseDate('2024-03-15', today)).toBe('2024-03-15')
    expect(parseDate('3/5/2024', today)).toBe('2024-03-05')
    expect(parseDate('03-15-2024', today)).toBe('2024-03-15')
    expect(parseDate('3/15/24', today)).toBe('2024-03-15')
    expect(parseDate('3/15/85', today)).toBe('1985-03-15')
    expect(parseDate('2024-03-15T00:00:00Z', today)).toBe('2024-03-15')
    expect(parseDate('2/30/2024', today)).toBeNull()
    expect(parseDate('March 15', today)).toBeNull()
  })

  it('reads rates as percents, including the 0.06125 form', () => {
    expect(parseRate('6.125')).toBe(6.125)
    expect(parseRate('6.125%')).toBe(6.125)
    expect(parseRate('0.06125')).toBe(6.125)
    expect(parseRate('45')).toBeNull()
    expect(parseRate('abc')).toBeNull()
  })

  it('reads terms in years or months', () => {
    expect(parseTermMonths('30')).toBe(360)
    expect(parseTermMonths('360')).toBe(360)
    expect(parseTermMonths('15 years')).toBe(180)
    expect(parseTermMonths('600')).toBeNull()
  })
})

describe('checkClientFile', () => {
  it('the template has every column and its example row passes', () => {
    const checked = checkClientFile(templateCsv(), today)
    expect(checked.missingRequired).toEqual([])
    expect(checked.ignoredColumns).toEqual([])
    expect(parseCsv(templateCsv())[0]).toEqual(COLUMNS.map((c) => c.key))
    expect(checked.rows).toHaveLength(1)
    expect(checked.rows[0].errors).toEqual([])
    expect(checked.rows[0].data).toMatchObject({
      lo_email: 'connor@mps.mortgage',
      stage: 'closed',
      closing_date: '2024-03-15',
      phone: '2145550100',
      loan_type: 'fha',
      term_months: 360,
      rate: 6.125,
      loan_amount: 300000,
      property: { address: '123 Sample Ln', state: 'TX', occupancy: 'primary', homestead_filed: false },
    })
  })

  it('matches headers however they are written, and names unknown ones', () => {
    const checked = checkClientFile(file(['Loan Officer Email', 'First Name', 'Last Name', 'Status', 'Phone Number', 'Favorite Color'], ['CONNOR@mps.mortgage', 'Ann', 'TEST', 'Pre-Approved', '214.555.0100', 'blue']), today)
    expect(checked.ignoredColumns).toEqual(['Favorite Color'])
    expect(checked.rows[0].data).toMatchObject({ lo_email: 'connor@mps.mortgage', stage: 'pre_approved', phone: '2145550100' })
  })

  it('never reads Social Security or tax ID columns', () => {
    const checked = checkClientFile(file(['lo_email', 'first_name', 'last_name', 'stage', 'email', 'SSN', 'Social Security #'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', 'ann@example.test', '123-45-6789', '123456789']), today)
    expect(checked.sensitiveColumns).toEqual(['SSN', 'Social Security #'])
    expect(JSON.stringify(checked.rows)).not.toContain('6789')
  })

  it('reports missing required columns', () => {
    expect(checkClientFile(file(['first_name', 'email'], ['Ann', 'a@example.test']), today).missingRequired).toEqual(['lo_email', 'last_name', 'stage'])
  })

  it('keeps rows with problems out and says why', () => {
    const header = ['lo_email', 'first_name', 'last_name', 'stage', 'email', 'phone', 'closing_date', 'lost_reason', 'property_address']
    const { rows } = checkClientFile(
      file(
        header,
        ['', 'A', 'TEST', 'lead', 'a@example.test', '', '', '', ''],
        ['connor@mps.mortgage', 'B', 'TEST', 'maybe', 'b@example.test', '', '', '', ''],
        ['connor@mps.mortgage', 'C', 'TEST', 'closed', 'c@example.test', '', '', '', ''],
        ['connor@mps.mortgage', 'D', 'TEST', 'lost', 'd@example.test', '', '', '', ''],
        ['connor@mps.mortgage', 'E', 'TEST', 'lead', '', '', '', '', ''],
        ['connor@mps.mortgage', 'F', 'TEST', 'closed', '', '', '1/2/2023', '', ''],
        ['connor@mps.mortgage', 'G', 'TEST', 'funded', '', '', '1/2/2023', '', '9 Sample Ct'],
      ),
      today,
    )
    expect(rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(rows[0].errors).toEqual(['lo_email is blank.'])
    expect(rows[1].errors).toEqual(['stage "maybe" isn\'t one of the LOSuite stages.'])
    expect(rows[2].errors).toEqual(['Closed rows need a closing_date.'])
    expect(rows[3].errors).toEqual(['Lost rows need a lost_reason.'])
    expect(rows[4].errors).toEqual(['Current clients need an email or a phone number.'])
    expect(rows[5].errors).toEqual(['Closed rows need an email, a phone number or a property address.'])
    expect(rows.slice(0, 6).every((r) => r.data === null)).toBe(true)
    // A closed client with only an address comes in, with a reminder about the email.
    expect(rows[6].errors).toEqual([])
    expect(rows[6].data?.stage).toBe('closed')
    expect(rows[6].warnings).toEqual(['No email: add one before sending follow-ups.'])
  })

  it('leaves values it can\'t read blank, with a warning, and keeps the row', () => {
    const { rows } = checkClientFile(
      file(['lo_email', 'first_name', 'last_name', 'stage', 'phone', 'rate', 'loan_type', 'birthday', 'email'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', '555-0100', 'six', 'Balloon', '13/40/1990', 'ann@example.test']),
      today,
    )
    expect(rows[0].data).toMatchObject({ phone: null, rate: null, loan_type: null, birthday: null, email: 'ann@example.test' })
    expect(rows[0].warnings).toHaveLength(4)
  })

  it('flags the same old site ID twice in one file', () => {
    const { rows } = checkClientFile(
      file(['lo_email', 'first_name', 'last_name', 'stage', 'email', 'old_site_id'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', 'a@example.test', 'X1'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', 'a@example.test', 'X1']),
      today,
    )
    expect(rows[1].warnings).toEqual(["Same old site ID as row 2; it updates that row's file."])
  })
})

describe('results', () => {
  it('counts outcomes and writes a report', () => {
    const { rows } = checkClientFile(file(['lo_email', 'first_name', 'last_name', 'stage', 'email'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', 'a@example.test'], ['', 'Bob', 'TEST', 'lead', 'b@example.test']), today)
    const results = [{ row: 2, status: 'added' as const, matched_by: null }]
    expect(importTotals(rows, results)).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 0, error: 1 })
    expect(parseCsv(reportCsv(rows, results))).toEqual([
      ['row', 'name', 'lo_email', 'result', 'matched_by', 'details'],
      ['2', 'Ann TEST', 'connor@mps.mortgage', 'added', '', ''],
      ['3', 'Bob TEST', '', 'error', '', 'lo_email is blank.'],
    ])
  })
})
