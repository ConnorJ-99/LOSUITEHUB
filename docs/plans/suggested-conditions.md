# Phase 8 plan: suggested conditions on each file

Approved by Connor 2026-11-11. It builds on what's there, so there is no second system.

## What's there today

* **Settings → Document checklist** (`document_rules`, `DocumentRulesCard`): 20 company rules. Each one fires on a profile fact (`document_condition`: wage earner, self-employed, gift, bankruptcy, owns a home and so on). `documentChecklist()` in `src/lib/prequal/nextStep.ts` turns them into each person's list.
* **Documents tab → Request checklist** (`document_requests`): the items you asked the borrower for. Each has a status (requested, received, reviewed or waived) and is keyed by rule and person.
* **Conditions tab** (`loan_conditions`): the lender's conditions, each with a party (borrower, title, realtor, processor/LO or appraisal) and a status. You type them or paste them in. Today nothing links a condition to a rule.
* **Product catalog rules** (`program_rules`): these are eligibility rules (LTV, FICO, reserves and so on) with citations. None of them says how many months of statements a program needs. The table the build plan calls `program_documents` doesn't exist. Guideline PDFs live in the lender documents and their passages.

## What I'll extend, and what I'll add

**Extend `document_rules`** (one list in Settings feeds both the borrower checklist and condition suggestions):

* **"Applies when"** filters, as array columns like Smart Fees uses:
  * loan type (Conventional, FHA, VA, USDA, Non-QM);
  * purpose (purchase, rate/term, cash-out, HELOC/HELOAN);
  * occupancy;
  * property type (condo, 2–4 units, manufactured);
  * income documentation (full doc, bank statement, 1099, asset depletion, DSCR);
  * Texas §50(a)(6) cash-out;
  * entity vesting (an LLC on the file);
  * a lender or program (optional).

  A rule with no filters works exactly as it does today.
* **Party** (who it's on, the same list as conditions) and **stage** (application, processing or before closing).
* **Use for:** "Borrower checklist and conditions" (all 20 existing rules), or "Conditions only" (the new starter rules). This keeps a purchase contract or a 12-day-notice task out of the document request text you send at prequal.
* New profile triggers: **VA funding fee exempt** (a VA loan whose upfront fee is set to 0), **entity vesting**, **Texas cash-out**, **condo** and **subject home being refinanced**.

**Extend `program_rules`** with three optional fields, typed by hand in the program's rule form with a citation (page and quote):
* bank statement months;
* asset statement months;
* tax return years.

When the selected program has one, its number replaces the rule's number and the suggestion shows "Lender guideline: [program], p. 14". The AI reader doesn't fill these yet; that's the "later" AI pass.

**Add to `loan_conditions`:**
* `source_key`: the suggestion it came from, one per loan.
* `document_request_id`: the matching document request, if there is one.

**Add one small table, `condition_dismissals`:** loan, key, who and when. Undo deletes the row.

**Pure code:** `suggestConditions(fileFacts, rules, existing)` in `src/lib/conditions/suggest.ts`, with tests. Nothing about suggestions is stored until you add one.

## How document requests and conditions stay in sync (never the same item twice)

Both lists use the same key: rule + person, plus the account or job when the item is specific to one. In code:
* **Already a condition:** a suggestion whose key matches a condition on the file isn't shown.
* **Already received on Documents:** a suggestion whose rule + person matches a document request that's **received or reviewed** isn't shown.
* **Requested but not in yet:** the suggestion shows "Requested on Documents, not in yet". Adding it links the condition to that request. When the request is marked received, the condition moves to Received on its own; a small database trigger does this, one way only.
* **The Documents checklist doesn't change.** It keeps working as it does today.

## The file-specific wording

Last 4 digits only, as always:
* one item per account: "2 most recent statements: Chase checking ••1234";
* one item per job: "W-2s 2024–2025 and 30 days of pay stubs: ABC Company";
* "2 years tax returns (2024, 2025): Sample LLC";
* the "why" line comes from the profile, for example "Gift on the 1003: $15,000 from Mom".

## The Conditions tab

* A collapsible **Suggested (N)** box above the list.
* Each suggestion shows its wording, why, source (Company rule: name, or Lender guideline: program and citation), party and stage.
* Each one has three buttons: **Add**, **Edit and add** and **Dismiss** (Dismiss can be undone).
* **Add all (N)** asks you to confirm first.
* Suggestions update whenever the file changes.
* A condition you added whose reason has gone (say, the gift was removed) is never deleted. It gets a flag instead: "No longer matches the file (gift removed)."
* Nothing is sent from here. Condition reminders stay drafts you approve.
* An **"AI suggestion"** source and the AI on/off gate are left ready, but not built.

## Starter rules (Conditions only; all editable, and each can be turned off)

* **Purchase:** executed contract and addenda (borrower or realtor); earnest money proof plus the account it came from; homeowners insurance quote and agent.
* **Refinance:** current mortgage statement and insurance declarations page for the home being refinanced; payoff authorization.
* **Texas cash-out (processor/LO):**
  * confirm the 12-day notice was delivered, and the sign-off timing;
  * any home-equity loan in the last 12 months;
  * the homestead survey if title requires it (title).
* **HELOC/HELOAN:** first-lien mortgage statement.
* **VA:**
  * Certificate of Eligibility;
  * DD-214 or a statement of service;
  * the funding-fee exemption letter, only when exempt.
* **FHA:** none.
* **USDA:** income documents for every adult in the household. One item, because the profile doesn't list household members.
* **Condo:** HOA contact for the questionnaire (title or realtor); master insurance policy.
* **Investment / DSCR:** leases or a rent schedule. With an LLC: articles, operating agreement and the EIN letter.

**Overlaps with today's rules.** I won't add these again; the existing rule is reused:
* **Gift letter:** the gift letter + transfer proof rule.
* **Divorce decree:** the support order rule.
* **Credit events:** the bankruptcy and foreclosure rules.
* **Kept rentals:** the leases rule.
* **Bank statement income:**
  * the existing 12–24 months of business statements rule;
  * the CPA letter or business license rule, which today is always asked. See question 1.
* **Homes you own:** the mortgage statement + insurance rule covers the borrower's other homes. The new refinance rule covers the home being refinanced, so the two don't repeat.

## Left out, because the profile doesn't have it

* New construction (there's no field for it).
* A list of household members (USDA).

Both can come later.

## Database script

One script, `20270112000000_suggested_conditions.sql`. It's safe to re-run, ends with a confirmation row, and is tested in PGlite (run twice, then a partial run followed by a full run).

## Tests

Following the build plan's test list:
* each starter rule fires, and doesn't fire, when it should: purchase vs refi, VA exempt vs not, condo, DSCR with an LLC, Texas cash-out;
* account wording uses the last 4 digits only;
* a program's citation overrides the rule's months;
* added and dismissed suggestions don't come back;
* a received document request hides its suggestion;
* removing a fact flags the condition and never deletes it.

## Connor's answers (2026-11-11, "Yes, build it")

1. **CPA letter or business license:** keep asking on every bank statement file, as today.
2. **Statement months on programs:** yes, add the three hand-typed fields with citations.
