# Prequal merged into the 1003 tab

Connor, 2026-11-16: "merge 1003 and prequal together, so the function of the prequal is now in the 1003: we can send or download prequal estimates, suggest documents to gather, see max approval." Plan only; waiting on his OK.

**Built 2026-11-16 as planned (quick-entry card kept).**

## Today
- **Prequal tab** (`src/components/prequal/`): a short 1003 in one draft that saves with one Save (borrowers' income, debts, homes, savings, credit history), plus:
  - Call notes → prequal (AI reads notes into the draft)
  - Max Approval (purchase): what-if inputs, result, "Save as Approval Limits"
  - Readiness (Not ready / Manual review / Needs documents / Ready) with "Draft document request"
  - Prequal results (payment, DTI, LTV, checks) and "Mark Pre-Qualified"
  - Send prequal results (saves the PDF to Documents, then the email)
  - A summary bar (max approval, payment, DTI)
- **1003 tab** (`src/components/urla/`): the full application by section, each saving on its own, with MISMO import/export and the section list.
- Both read and write the same records, so nothing has to move in the database.

## Proposed layout (one tab, named "1003")
- **Left, top:** "Phone prequal" card, collapsed once the 1003 has income: the call-notes reader and the quick-entry fields (income, debts, homes, savings) with one Save. It writes the same 1003 records as today.
- **Left, below:** the full 1003 sections, unchanged.
- **Right column (sticky on a computer, after the form on a phone):**
  1. Max Approval (purchase): result, the what-if inputs (rate, term, max payment, VA fee…), Save as Approval Limits.
  2. Readiness with **Suggested documents**: the suggested checklist items, with Draft document request (and Request documents on Docs & Conditions).
  3. Prequal results + Mark Pre-Qualified.
  4. **Prequal Results PDF:** **Download** (new; nothing sent) and **Send…** (as today).
- **Summary bar:** max approval / limited by / payment / DTI (purchase), or payment / DTI / LTV.
- The figures follow saved 1003 data and the quick-entry draft while it's being typed.
- **Prequal tab removed** from the file menu; old `?tab=prequal` links open the 1003. Closed files keep the 1003 read-only, with no prequal column.
- No database change.

## Build order
1. Move the right-column cards into the 1003 tab, reading the saved 1003; add Download PDF.
2. Phone prequal card (call notes + quick entry) at the top; remove the Prequal tab and redirect.
3. Tests, a phone check, CLAUDE.md.

## Questions for Connor
- Keep the quick-entry "Phone prequal" card for calls, or work only in the full 1003 sections? (Recommended: keep it, collapsed.)
- "Prequal estimates" = the one-page Prequal Results PDF (buying power, payment, cash needed). If you meant Fee Estimates from Scenarios & Estimate, say so.
