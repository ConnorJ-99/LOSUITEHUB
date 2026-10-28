# Pre-Qual Tool (Phone + In-Person) — Build Prompt

Saved as Connor wrote it (2026-10-27). Not started. Mockup: `docs/design-reference/prequal-tool/prequal-tool-mockup.pdf` (page 1 Phone Pre-Qual, LO view; page 2 Present mode, borrower view). Build order: right after Settings (signature and logo), before loading real lenders.

## Prompt

Build out the borrower Pre-Qual tool in LOSuite. I use it live on the phone and in person, so speed matters more than completeness. A design mockup exists (two screens: "Phone Pre-Qual (LO view)" and "Present mode (borrower view)"); match its layout and style.

Before writing code: review the existing Phone prequal tab, the mortgage math library and the income calculator. Tell me what already exists, what's missing against this spec, and your step-by-step plan. Wait for my OK before building. Reuse the tested math library — don't write new payment or DTI math.

### 1. Mode tabs and toolbar
A pill tab row at the top of the Pre-Qual tool:
- Phone Pre-Qual (default): the quick-entry screen below
- Full 1003: opens the existing 1003, pre-filled from the pre-qual inputs
- Playground: saved what-if scenarios compared side by side, each exportable as a PDF
- Present: the borrower-facing full-screen view

One Save button in the header with a "Saved X min ago" indicator. Autosave every change. No Duplicate, In-person mode or Download XML buttons.

### 2. Phone Pre-Qual: inputs (left column)
Five numbered sections, every field optional, in this order so I can ask them in order on a call:
1. Borrower: name, phone, co-borrower (yes/no + relationship), first-time buyer
2. Income: borrower monthly gross, co-borrower monthly gross, income type (W-2, self-employed, 1099, retired, other), time at job. Link to open the income calculator; its result fills these fields.
3. Monthly debts: auto, student loans, credit cards, other, with a running total
4. Credit and funds: estimated credit score (ranges in 20-point bands), savings and checking, gift funds
5. Target: program (Conventional, FHA, VA, USDA, Non-QM), down payment % or $, county (my 14 DFW counties, using the existing property tax logic), rate assumption (editable default)

If anything is already in the borrower file (from a web lead form or call notes), pre-fill it.

### 3. Results (right column, updates live as I type)
- Status chip using the 9 outcomes: Prequalified, Prequalified with DPA, Prequalified with Co-borrower, Credit Improvement Needed, DTI Improvement Needed, Asset Improvement Needed, Multiple Issues, Manual Review, Future Buyer. Route self-employed, 1099 and Non-QM-shaped borrowers to Manual Review, not "not qualified."
- Estimated max purchase price (large)
- Comfortable search range and payment range (lower DTI target than the max)
- Estimated cash to close and funds left after closing
- Housing ratio and total debt ratio at max, as bars, using the selected program's limits
- Assumptions line: program, down payment, rate, term, county taxes, insurance. Plus "Estimate only, not a loan approval."

### 4. Actions
- Send estimate · email + text (primary): sends the existing Pre-Qualification Estimate email template filled with these results, plus a short SMS with a link. Show a preview before sending. Send through the GHL connection once it's built; until then, use the current email setup and leave the SMS behind a feature flag.
- Save to Playground: saves the current inputs and results as a named scenario
- Start full 1003: pushes all inputs into the 1003 and switches tabs
- Log every send and status change to the borrower's timeline

### 5. "Ask next" panel
Under the actions, show 2–4 follow-up questions based on what's missing or risky, for example:
- missing credit history → "Any late payments or collections in the last 12 months?"
- large savings → "Where are the funds held, and have they been there 60 days?"
- co-borrower income → "Does the co-borrower have a 2-year history?"
- self-employed → "How many years filing as self-employed?"

Rule-based first. Use the AI assistant only once it's live.

### 6. Playground
- Save multiple scenarios per borrower (vary price, program, down payment, rate, debts paid off)
- Compare 2–4 side by side: max price, payment, cash to close, DTI, status
- Export one or all as an MPS-branded PDF
- Load any scenario back into the Phone Pre-Qual screen

### 7. Present mode
A clean full-screen view for showing the borrower in person or on a screen share:
- Large "Here's what your numbers show" headline
- Max purchase price, comfortable range, payment range
- Next step card: "Complete the full application so we can verify and issue your pre-approval."
- Assumptions and disclaimer in the footer, plus "MPS Mortgage LLC · NMLS #2501110"
- No internal info: no ratios, no status chip, no "ask next" questions, no borrower debts
- Esc or a small button returns to Phone Pre-Qual

### 8. Design
Use the app's editorial theme:
- Background `#F3EFE9`, white cards with soft shadow, text `#1A1A1A`, muted text `#6B6560`
- Headlines: Anton, uppercase. Body: Inter. All numbers, money and phone numbers: JetBrains Mono
- Primary action `#C8441F` (white text), secondary navy `#1F2A5C`, positive status chip `#DDE6DA` with `#2F4A31` text, mustard `#C9A13B` as the accent bar under the max price
- 44px minimum touch targets. Works on an iPad for in-person meetings.

### 9. Acceptance checks
- Entering income $10,900/mo, debts $755/mo, FHA, 5% down, 6.75%, Tarrant County gives results consistent with my sample email (max about $511K, comfortable range about $430K–$470K, payment about $3,489–$3,814). Add this as a test.
- Results update in under 200ms per keystroke
- Present mode shows no internal data
- Every send is logged to the timeline
- Save, reload and switch modes without losing data

Build in small steps and commit after each one. Show me each step before moving on.

## Notes for whoever builds it (Claude Code, 2026-10-27)
- Two colors here differ from the restyle already in the app: muted text `#6B6560` (app uses `#8A8580`) and primary action `#C8441F` (app's urgent color is `#E0532F`). Ask Connor which to keep app-wide before building, so the app has one palette.
- "Send estimate" needs a way to send email; LOSuite has none yet (drafts go to the Action Queue). Until the GHL connection exists, the likely path is a draft in the Action Queue to copy, unless Connor wants a separate email setup.
