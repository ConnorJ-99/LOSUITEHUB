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
    const checked = checkClientFile(file(['lo_email', 'first_name', 'last_name', 'stage', 'email', 'SSN', 'Social Security #', 'Borrower ITIN', 'Tax_ID', 'TIN'], ['connor@mps.mortgage', 'Ann', 'TEST', 'lead', 'ann@example.test', '123-45-6789', '123456789', '900-70-6789', '12-3456789', '98-7656789']), today)
    expect(checked.sensitiveColumns).toEqual(['SSN', 'Social Security #', 'Borrower ITIN', 'Tax_ID', 'TIN'])
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

  it("reads ARIVE's pipeline export as it comes (Connor's columns, 2026-10-29)", () => {
    const arive = 'Primary Borrower\tARIVE Loan Id\tCo-Borrower\tSubject Property\tSubject State\tAdverse\tApp Completion Percentage\tApproved with Conditions\tClear To Close\tDisclosed\tDocs Signed / Loan Closed\tLoan Funded\tPreApproval Date\tStage Name\tSubmit to Underwriting\tSuspended\tLock Date\tLock Expiration\tLock Expiration Timezone\tPrimary Loan Officer NMLS\tPrimary Loan Officer Name\tLender\tPurchase Date\tApp/TRID Completed Date\tEst. Funding Date\tFirm Closing Date\tCo-Borrower First Name\tCo-Borrower Last Name\tPrimary Borrower First Name\tPrimary Borrower Last Name\tWarehouse Bank\tPrimary Borrower Cell Phone\tPrimary Borrower Email\tCo-Borrower Email\tCo-Borrower Cell Phone\tCo-Borrower Birthday\tPrimary Borrower Birthday\tMortgage Type\tLoan FICO\tLien Position\tDTI\tCLTV\tBase Loan Amount\tAmortization Term\tAmortization Type\tLTV\tAppraised Value\tSubject Address Line 1\tSubject Address Line 2\tSubject City\tSubject County\tOccupancy\tBase Price\tLoan Product\tPrimary Loan Officer Email\tLender Loan #\tCompensation Amount\tGross Loan Revenue'.split('\t')
    // The columns Connor is adding to the report.
    const header = [...arive, 'Loan Purpose', 'Note Rate', 'Purchase Price', 'Subject Zip', 'First Payment Date', 'Total Monthly Payment']
    const row = (over: Record<string, string>) => header.map((h) => over[h] ?? '')
    const base = { 'Primary Borrower First Name': 'Ann', 'Primary Borrower Last Name': 'TEST', 'Primary Loan Officer Email': 'connor@mps.mortgage', 'Primary Borrower Email': 'ann@example.test', 'Subject Address Line 1': '1 Test Ln', 'Subject City': 'Frisco', 'Subject State': 'TX', 'Base Price': '100.25' }
    const { rows, missingRequired, sensitiveColumns } = checkClientFile(
      file(
        header,
        row({ ...base, 'ARIVE Loan Id': 'A-100', 'Stage Name': 'Funded', 'Loan Purpose': 'Purchase', 'Docs Signed / Loan Closed': '06/10/2022', 'Loan Funded': '06/11/2022', 'Firm Closing Date': '06/09/2022', 'Mortgage Type': 'FHA', 'Base Loan Amount': '$300,000.00', 'Amortization Term': '360', 'Note Rate': '5.125', 'Purchase Price': '310000', 'Appraised Value': '312000', 'Occupancy': 'Primary Residence', 'Loan Product': 'FHA 30 Fixed', 'Primary Borrower Cell Phone': '(214) 555-0100', 'Primary Borrower Birthday': '03/15/1985', 'Co-Borrower First Name': 'Bo', 'Co-Borrower Last Name': 'TEST', 'Co-Borrower Cell Phone': '214-555-0101', 'Subject Zip': '75034' }),
        // A later refi of the same home: no Docs Signed date, so Loan Funded is the closing date.
        row({ ...base, 'ARIVE Loan Id': 'A-200', 'Stage Name': 'Loan Funded', 'Loan Purpose': 'No Cash-Out Refinance', 'Loan Funded': '2024-09-20', 'Firm Closing Date': '09/18/2024', 'Mortgage Type': 'Conventional', 'Base Loan Amount': '280000', 'Occupancy': 'Investment Property' }),
      ),
      today,
    )
    expect(missingRequired).toEqual([])
    expect(sensitiveColumns).toEqual([])
    expect(rows.map((r) => r.errors)).toEqual([[], []])
    const [purchase, refi] = rows.map((r) => r.data!)
    expect(purchase).toMatchObject({
      lo_email: 'connor@mps.mortgage', first_name: 'Ann', last_name: 'TEST', stage: 'closed', purpose: 'purchase', closing_date: '2022-06-10',
      loan_type: 'fha', loan_amount: 300000, term_months: 360, rate: 5.125, purchase_price: 310000, program: 'FHA 30 Fixed', arive_loan_number: 'A-100',
      phone: '2145550100', birthday: '1985-03-15', co: { first_name: 'Bo', last_name: 'TEST', phone: '2145550101' },
      property: { address: '1 Test Ln', city: 'Frisco', state: 'TX', zip: '75034', occupancy: 'primary', estimated_value: 312000 },
    })
    expect(refi).toMatchObject({ stage: 'closed', purpose: 'refinance_rate_term', closing_date: '2024-09-20', loan_type: 'conventional', arive_loan_number: 'A-200', property: { occupancy: 'investment' } })
    // ARIVE's Base Price is the lender's pricing, never the home's price.
    expect(refi.purchase_price).toBeNull()
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
