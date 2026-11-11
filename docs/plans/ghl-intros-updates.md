# Plan: GoHighLevel intro texts and loan-update prompts

Connor's request (2026-11-11), approved and built the same day ("Yes, build it now"; milestone list as proposed). Nothing sends on its own: every message is a draft you edit and send with a click, through the usual send checks (consent, opt-outs, sending hours, the LO's own GHL number).

## What's already there (Phase 3, committed)

* New Lead has an **Add to GoHighLevel after saving** chip next to "Start prequal call after saving".
* Borrowers (Messages tab) and partners (Partner center) have an **Add to GoHighLevel** button. Someone already in GHL is linked to their existing contact, never added twice.

## A. Borrower intro text

After a borrower is added to GoHighLevel (from New Lead or the button), an **Intro text** box opens with a draft you can edit:

> Hi {first name}, this is {your first name} with MPS Mortgage. This is my work number. I'll send your loan updates from here, but for anything else my personal cell is {your personal cell}.

* Your personal cell comes from Settings → My profile (already there). Without one, that sentence is left out.
* It goes from your GHL work number. A brand-new lead usually has no text consent recorded yet, so the box has an **"They said OK to texts"** chip. Turning it on records consent with a note, the same as the Messages tab does today. Without consent it can't send.
* **Send**, **Save as draft** (to the Action Queue), or **Skip**.

## B. Realtor and partner intro text

When an agent, title or other partner is added to a file's team (from the contract's "Add to team", or by hand):

1. If they aren't linked to GoHighLevel yet, they're added (or matched to their existing GHL contact, never a duplicate), assigned to the file's LO.
2. An intro draft opens:

   > Hi {first name}, this is {your first name} with MPS Mortgage, working with {borrower first name} on {address or "their loan"}. I'll send loan updates from this number; my personal cell is {your personal cell} anytime.

**New:** today texts can only go to borrowers. Sending to partners needs one database script: messages and send approvals get a partner, and the ghl function's send checks a partner's consent and opt-outs the same way. Partner replies show in the Inbox like borrower replies.

## C. "Update the borrower and realtors?" prompts

When one of these happens on a file, a box opens with a drafted update for each person on the file who can get one: the borrower(s), buyer's agent and listing agent. Each has a tick box. Send them, save them to the Action Queue, or skip.

Proposed milestones (please confirm or change the list):

| When | Update says (short, editable) |
| --- | --- |
| Appraisal ordered (workflow step) | the appraisal has been ordered |
| Appraisal received | the appraisal is in |
| Moved to Submitted / Processing | the file is with underwriting |
| A workflow step or task named "approval" (not pre-approval) | approved with conditions, working on them (there is no separate Approved stage) |
| Moved to Clear to Close | clear to close, closing on {date} |
| Closing date changed on the Overview (files Under Contract to Clear to Close) | the new closing date |
| Moved to Closed | closed: thank you |

* Wording is built in code from the file (no AI), with the compliance rules the drafts already follow.
* Realtors only get updates on files where they're on the team, and never any loan figures, credit or income: only the milestone and dates.
* Any other task: a small **Send an update** button on the task's done message, opening the same box with a blank update.

## Built

* Partner replies aren't matched to the partner yet: they land in the Inbox's Needs matching (admins), like any unknown number.
* Steps and tasks are matched to milestones by name ("Order appraisal", "Appraisal received", "Clear to close"…). Any other finished step or task shows "Send an update" on its done message.
