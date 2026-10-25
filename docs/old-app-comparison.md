# Old LOSuite vs LOSuite v2: feature comparison

Prepared 2026-10-25 from the old app's code (`mpsmortgagelosuite.zip`: screens, libraries, roadmap and its 39 saved plans). Nothing in the old app was run, and its `.env` (production keys) was not opened.

**Status key**
- **In v2**: already built in LOSuite v2.
- **Planned**: already in v2's phase plan or "Later" list (CLAUDE.md).
- **Not in v2**: not built and not on the plan yet.

**Suggestion key** (my take; you decide)
- **Bring soon**: high value for daily work, fits v2's design.
- **Bring later**: useful, but wait for its phase or for core pieces.
- **Skip / rethink**: heavy, overlapping, or something the old app itself paused.

---

## 1. Leads and pipeline

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Pipeline board and list with stages, drag and drop | In v2 | — | Phase 1. |
| Stage history and days in stage | In v2 | — | Phase 1. |
| Separate boards per loan type (Purchase, Refinance, Investment, HELOC/HELOAN) | Not in v2 | Bring later | v2 has one board with a purpose filter. Separate boards are views over the same stages, so they're cheap to add. |
| New Leads inbox for web-form leads (kept out of the boards until reviewed) | Not in v2 | Bring soon | Needs a web-form or webhook intake first (see section 9). |
| New-lead snapshot (one-screen view before opening the full profile) | Partly | Bring later | v2's Overview plus the Prequal tab cover most of it. |
| Lead priority flag, sub-stage, move timeframe, documentation type | Not in v2 | Bring later | Small fields on the loan; good pipeline filters. |
| "My Pipeline" (only your assigned leads) | In v2 | — | Row Level Security already limits loan officers to their own loans. |
| Bulk lead import / bulk edit | Not in v2 | Bring later | Overlaps with the planned data migration from the old app. |
| Duplicate detection when adding a lead | In v2 | — | New Lead warns when the person already exists. |
| Lead routing rules (auto-assign to an LO) | Not in v2 | Bring later | Only matters once there's more than one LO. |
| Lost leads view with reasons | In v2 | — | Lost stage requires a reason. |

## 2. Borrower profile and 1003

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Full 1003 with co-borrowers | In v2 | — | Phase 3a. |
| MISMO 3.4 import/export (Arive) | In v2 | — | Phases 3b/3c. Your Arive test is still pending. |
| Notes, pinned notes, tasks | In v2 | — | Phase 2. |
| Editable tasks with sub-items, reminders, Kanban task snippets | Partly | Bring later | v2 tasks are simpler (title, due date, done). |
| Unified "My Tasks" across loans | In v2 | — | Dashboard. |
| Properties of interest / Saved Homes table | In v2 (simpler) | Bring later | v2 Properties tab; the old one added search, filters and a per-home financing workspace. |
| Refinance workspace (current mortgage → proposed outcome) | In v2 | — | Overview adapts by purpose, with Texas cash-out flags. |
| Pipeline tab on the profile ("what has to happen next") | Not in v2 | Bring later | Nice once tasks and documents exist. |
| Letter of explanation (LOE) generator | Not in v2 | Bring later | Fits Phase 6 (PDFs). |
| Conditions list and document-to-condition links | Not in v2 | Skip / rethink | LOS work that Arive already does. |
| Funding checklist, closing package, closing disclosure balancer | Not in v2 | Skip / rethink | Also LOS territory. The CD balancer could come back as a standalone calculator. |

## 3. Prequal and qualification

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Phone prequal with live results | In v2 | — | Just built (not committed yet). |
| Mobile quick prequal with text/email/share handoff | Partly | Bring soon | v2's Prequal tab works on a phone; sharing a summary by text/email isn't built. |
| Max purchase price at the DTI limit | In v2 | — | v2 shows one limit you set per call. |
| Buying power at 43 / 45 / 50% DTI side by side | Not in v2 | Bring soon | Small addition to the results panel. |
| Real estate owned in the prequal: keep / rent / sell each property (sale proceeds count toward the down payment) | Partly | Bring soon | v2 counts retained rentals; it has no "sell" plan with proceeds. |
| Savings "use as": down payment, asset-depletion income, reserves | Not in v2 | Bring soon | Adds reserves months and depletion income. |
| Paid-off-at-closing toggle on each debt | Partly | Bring soon | v2 respects the flag but you can't flip it from the prequal yet. |
| "Use all available for down payment" button | Not in v2 | Bring soon | One button. |
| Playground: saved what-if scenarios, compare 2–4, "Can they afford $___?" with levers (pay off a debt, sell a property) | Not in v2 | Bring soon | Needs one new table (saved scenarios); needs your OK. |
| Scenario PDF export (borrower copy / internal copy) | Not in v2 | Bring later | Phase 6 (PDFs). |
| Present mode (borrower-facing presentation on a second screen) | Not in v2 | Bring later | Builds on saved scenarios. |
| In-person refinance intake (7 steps, mortgage statement scan) | Not in v2 | Bring later | The statement scan is AI; the rest fits the Prequal tab for refinances. |
| Refinance checkup for past clients | Not in v2 | Bring later | Pairs with closed-loan nurture (section 7). |
| Loan strategies (several qualification approaches per borrower, pick a primary) | Not in v2 | Skip / rethink | Overlaps with saved scenarios; scenarios are simpler. |
| Pre-approval underwriting checks (AI "underwriter") | Not in v2 | Skip / rethink | AUS in Arive does this. |

## 4. Income

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Income worksheets: W-2, hourly, variable, self-employed (Sch C / 1120S / 1065), bank statement, rental | In v2 | — | Phase 4. |
| Income analyzer page (standalone, no borrower) | Not in v2 | Bring later | v2's worksheets live on a borrower; a standalone version is easy. |
| Asset depletion income | Not in v2 | Bring soon | Comes with "use as" in section 3. |
| Saved bank-statement analyses | Partly | — | v2 saves bank-statement worksheets. |
| AI income document review (read W-2s, returns) | Planned (Later) | Bring later | On v2's "Later: AI tools". |

## 5. Calculators (old `/calculators`)

| Old app calculator | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Max prequal | In v2 | — | Prequal tab. |
| Self-employed, bank statement | In v2 | — | Income tab. |
| Asset depletion | Not in v2 | Bring soon | See section 3. |
| Rate stack (cost/credit by rate) | Not in v2 | Bring later | Fits Phase 5 Loan Info / quotes. |
| Payoff calculator | Not in v2 | Bring later | Simple. |
| Property tax calculator | Partly | Bring later | v2 uses a tax-rate estimate. |
| Bridge loan, fix-and-flip | Not in v2 | Bring later | Niche; quick to add as pure calculators. |
| Closing disclosure balancer | Not in v2 | Skip / rethink | LOS-side. |

## 6. Loan scenario, pricing and lenders

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Lenders, programs, matrix rows, admin screens | Planned (Phase 5) | — | v2 design already covers this. |
| Lender matcher / Product Search with excluded-program reasons | Planned (Phase 5) | — | |
| Saved lender scenarios | Planned (Phase 5) | — | "Scenarios saved to history". |
| Lender Q&A, guideline library, AI guideline chat with citations ("CADDIE AI") | Planned (Later) | Bring later | v2's "guideline assistant". The old app found a bug that corrupted its search index; worth rebuilding cleanly. |
| Loan Estimate management and PDF auto-fill | Not in v2 | Bring later | Big feature tied to MyHome; consider after Phase 6. |
| Rate incentives on builder listings | Not in v2 | Skip / rethink | Part of the Realtor/builder marketing area. |

## 7. Documents, letters and PDFs

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Pre-approval / prequal letters (PDF, saved to the file, share link) | Planned (Phase 6) | — | |
| Borrower documents area with categories and private previews | Planned (Phase 6) | — | v2 Documents tab is greyed out until Phase 6. |
| Secure upload links for borrowers | Not in v2 | Bring later | Needs Supabase Storage; pairs with Phase 6. |
| E-signature pages | Not in v2 | Skip / rethink | Arive and DocuSign cover this. |
| AI contract review and file chat | Planned (Later) | Bring later | v2 "Later: AI tools (contract review)". |
| Open house flyers with financing | Not in v2 | Bring later | Part of the Realtor marketing area. |

## 8. Closed loans and nurture

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Closed loans list and individual closed-loan file | Planned (Later) | Bring later | v2 "closed-loan monitoring and nurture". |
| Retention: anniversaries, refinance alerts, renewals | Planned (Later) | Bring later | Needs automations and messaging first. |
| Nurture board for not-ready leads | Partly | Bring later | v2 has a Nurture stage; no separate nurture workflow. |
| Commission tracking and comp report | Planned (Later) | Bring later | v2 "revenue and comp ledger". |
| HMDA report | Not in v2 | Bring later | Demographics are already captured in the 1003. |
| Analytics dashboard (volume, conversion, ad spend) | Not in v2 | Bring later | Easy once there's data. |

## 9. Communication and automation

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| GoHighLevel SMS/email bridge | Planned (Later) | Bring later | |
| Automations engine (triggers, waits, branches, AI steps) | Planned (Later) | Bring later | v2 calls for locks, pause state and a failure circuit breaker. |
| Email templates, merge fields, email builder | Not in v2 | Bring later | Comes with messaging. |
| Text templates and drafts | Not in v2 | Bring later | Comes with messaging. |
| Call Mode: call queue synced desktop ↔ phone, call history into notes | Not in v2 | Bring soon | Pairs naturally with the new phone prequal. Needs a small table for the queue; needs your OK. |
| Web forms and public lead capture (`/f/…`, `/qualify/…`, quick-prequal links) | Not in v2 | Bring soon | Feeds the New Leads inbox. Public pages need extra security care. |
| Booking pages / scheduling, calendar | Not in v2 | Bring later | |
| Digital contact cards (`/card/…`) | Not in v2 | Bring later | Marketing. |
| Events pages | Not in v2 | Skip / rethink | |

## 10. Realtor partners and borrower apps

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Realtor/partner directory, profiles, referral tracking | Planned (Later) | Bring later | v2 "partner/realtor management". The Referral source field exists today. |
| Realtor partner portal (logins, buyers, requests, messages, prequal link) | Not in v2 | Bring later | Large; needs its own security design. |
| Listings, open houses, marketing center, AI listing copy, social kits | Not in v2 | Skip / rethink | A whole second product. Consider only if partner marketing is a priority. |
| Builder partner profiles | Not in v2 | Skip / rethink | |
| Shared home search hub (buyer, realtor, LO) and showing lists | Not in v2 | Bring later | Depends on the portal and MyHome. |
| MyHome borrower app integration | Planned (Later) | Bring later | The old app built a lot here (invitations, shared homes, estimates, uploads). |
| Borrower login / intake / apply links | Not in v2 | Bring later | Comes with MyHome. |

## 11. Team, admin and workspace extras

| Old app feature | v2 status | Suggestion | Notes |
| --- | --- | --- | --- |
| Organizations, roles, Row Level Security | In v2 | — | Phase 0. |
| Settings: company, LO profile, NMLS | In v2 | — | Phase 3a. |
| Users admin, per-user feature switches, "act as user" | Not in v2 | Bring later | Only needed with more staff. "Act as user" needs careful security. |
| Company Hub (links, lenders directory, shared passwords) | Not in v2 | Skip / rethink | Storing passwords in the CRM is risky; a password manager is safer. |
| Mobile app shell with bottom tabs (`/m/…`) | Partly | Bring later | v2 pages are responsive; a dedicated phone home screen could come with Call Mode. |
| Notebooks / Workshop (infinite canvas, Apple Pencil) | Not in v2 | Skip / rethink | |
| Studio (marketing design) | Not in v2 | Skip / rethink | |

---

## Short list I'd suggest

These fit what we just built and are each a contained piece of work:

1. **Prequal upgrades:** buying power at 43/45/50%, the payoff toggle, "use all for down payment", real estate keep/rent/sell with sale proceeds, savings "use as" (down payment, depletion income, reserves) and reserves months. No new tables.
2. **Saved scenarios (Playground):** save, compare 2–4 side by side, "Can they afford $___?". One new table.
3. **Call Mode + phone home screen:** a call queue that follows you between computer and phone, with call notes saved to the borrower. One small table.
4. **Web form intake + New Leads inbox:** public prequal and contact forms that create leads you review before they enter a board.

Then continue with Phase 5 (Loan Info + Product Search) and Phase 6 (letters and PDFs), which pick up several old-app items on their own.
