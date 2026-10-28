# LOSuite Follow-Up Build Plan (requested, not scheduled)

Oct 27, 2026 · Connor. To build **after the current phases are complete** (Connor, 2026-10-27). Saved as Connor wrote it.

## Overview
LOSuite gets a closed-client list with reminders, a GHL connection, and a daily agent that drafts follow-ups for Connor to approve on the home page. Each phase depends on the one before it, so build in this order:
1. Closed loan profile (the data model)
2. Closed list, CSV import and export, reminders
3. GHL connection (send and receive texts and email)
4. Daily follow-up agent with approvals on the home page
5. Appointment booking

GHL is the delivery pipe only. LOSuite stays the source of truth for client data and decides who gets contacted.

## Phase 1: Closed loan profile
Build the closed loan profile first so imported loans land in the right fields. When an active loan closes in LOSuite, it should convert into this profile automatically, reusing the existing single-source closing date and insurance date fields.

| Group | Fields |
|---|---|
| Borrowers | Names, phone, email (required), mailing address, co-borrower, birthday (optional) |
| Property | Address, occupancy, purchase price, estimated current value |
| Loan | Lender, program, loan amount, rate, term, closing date, first payment date, PITI |
| Insurance and tax | Homeowners insurance carrier and renewal date, homestead filed (yes or no) |
| Relationships | Referring agent, title company, linked prior or repeat loans |
| Follow-up | Last contact date, next reminder, communication consent (SMS and email), notes |

- [ ] Make borrower email and phone required before a loan can be marked closed
- [ ] Link repeat and refinance clients to their prior loan
- [ ] Add a closed loan detail page with a timeline of all contact history

## Phase 2: Closed list, CSV import and export, reminders
The closed list is a searchable table of every closed client, filterable by closing year, lender, agent and next reminder date.

CSV import
- [ ] Download a blank CSV template that matches the closed loan profile fields
- [ ] Upload a filled CSV with a preview step that shows matches, duplicates and missing emails before saving
- [ ] Match duplicates on borrower name plus property address

CSV export
- [ ] Export the current filtered list to CSV

Reminders (auto-created per closed loan)

| Reminder | When |
|---|---|
| Closing thank-you and review request | 3 days after closing |
| First payment check-in | 1 week before first payment |
| Homestead exemption reminder | January after closing |
| Insurance renewal and rate review | 30 days before renewal |
| Home anniversary | Each year on closing date |
| Birthday | Each year, if on file |
| Rate watch | When market rates fall enough to justify a refi (threshold set by Connor) |

Reminders show on the home page and feed the agent in Phase 4.

## Phase 3: GHL connection
Connect LOSuite to the MPS Mortgage sub-account with the existing Private Integration Token, replacing Twilio and SendGrid. Messages send from info@mps.mortgage and the MPS number; replies route by contact owner in LOSuite.
- [ ] Store the token as a server-side secret, never in the browser
- [ ] Sync contacts: create or match a GHL contact for each LOSuite borrower (match on phone, then email)
- [ ] Send SMS and email through GHL conversations
- [ ] Receive inbound replies through a GHL webhook and attach them to the borrower in LOSuite
- [ ] Sync opt-outs (STOP replies, DND) from GHL back to LOSuite consent fields
- [ ] Log every GHL call and message in Supabase

GHL workflows and funnels stay in GHL. LOSuite can enroll a contact in an existing workflow but cannot build one through the API.

## Phase 4: Daily follow-up agent with home page approvals
Every morning the agent reviews clients, decides who needs a touch, and puts drafted messages on the home page. Nothing sends until Connor taps approve.

Who it reviews
- Closed clients with a reminder due
- Nurture and active leads with no reply or contact in a set number of days
- Anyone who replied and is waiting on an answer

What it checks per client
1. Did they respond to the last message? If not, how long ago was it sent?
2. Is a reminder or key date coming up?
3. What is in the file (stage, goals, last notes) that makes the message personal?
4. Consent, opt-out status and touches already sent this week

Home page approval queue
- One card per draft: client name, why they were picked, channel (SMS or email) and the drafted message
- Buttons: Approve and send, Edit, Snooze, Skip
- Inbound replies the agent can't handle (rates, approval, complaints) appear flagged for Connor

- [ ] Run the scan on a schedule each weekday morning
- [ ] Draft with the Claude API using the client's file as context
- [ ] Send approved messages through the GHL connection
- [ ] Record outcome (sent, edited, skipped) so drafts improve over time

## Phase 5: Appointment booking
Use Connor's GHL calendar so bookings land in one place.
- [ ] Include a GHL booking link in drafted messages when a call makes sense
- [ ] When a client replies with a time, the agent checks GHL availability and drafts a confirmation for approval
- [ ] Show upcoming appointments on the LOSuite home page and the client's profile
- [ ] Use a GHL workflow for reminders and no-show rebooking

## Guardrails and prerequisites
Fix these before the agent sends anything.
- [ ] Add a lock to the automations engine so the same message can't send twice
- [ ] Backfill emails and phones for closed loans (238 of 247 have no email on file)
- [ ] Only message clients with recorded SMS or email consent; stop immediately on STOP or unsubscribe
- [ ] Send texts only within allowed Texas hours (confirm the window with compliance)
- [ ] No rate quotes or payment figures without Connor's review
- [ ] Cap touches per client per week
- [ ] Keep approve-before-send on until Connor decides to loosen it

## Out of scope
Skipped from the original 22-system list for now: client health score, NPS survey, team EOD reports, CEO and sales dashboards, pre-call research brief, pitch deck, call grader, AI client recaps and AI chief of staff.
