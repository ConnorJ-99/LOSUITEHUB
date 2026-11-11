# Plan: weekly product-highlight email to realtors

Connor's request (2026-11-11). Approved with his answers below; build it **after Phase 9**.

> "Realtors that we now have in the pipeline, we can be sending them weekly emails for product highlights (from our product list)."

## How it would work

1. **Settings → Weekly realtor email** (owners and admins): turn it on, pick the day (default Monday), and write a short intro line if you like.
2. **Each week**, on that day, MPS-HQ drafts the email for you on the Today page. It is never sent by itself (Rule #0):
   * a subject, such as "This week's loan programs: 3 ways to win more offers";
   * 2–3 **program highlights** from the product list, each with its name, who it's for and 2–3 plain features (for example "Bank statement: self-employed buyers, 12 or 24 months of statements, no tax returns");
   * your signature with NMLS, the company NMLS and Equal Housing;
   * an **unsubscribe link** that turns off email for that realtor (required for marketing email).
3. You **pick or swap the programs**, edit the words, preview it, and press **Send to N realtors**: one approval for the batch, then it goes out through GoHighLevel from your email, a few a minute, inside sending hours, under the daily cap.
4. **Who gets it:** realtors in the Partner center whose stage is Active or Nurture (or a stage list you choose), with email consent and no opt-out, assigned to you (an admin can send for everyone). Each realtor gets one email even if they're on several files.

## Picking the programs

* **This week's picks**, which you choose from Lenders / Product Search with a "Feature in the weekly email" button, or in the draft's picker. Nothing is picked for you.
* The picker shows when each program was last featured, so you can avoid repeats.
* **No lender names and no rates.** The email describes the program type, never the lender, the same as the borrower PDFs.

## Compliance (please confirm with your compliance contact)

* No rates, APRs or payments. Down payment percentages ("3% down") and "no income documentation" style claims can be advertising trigger terms, so the default wording avoids numbers. A Settings switch allows them once compliance approves, adding the required disclosure.
* Unsubscribe in every email; the company address and NMLS in the footer (CAN-SPAM).
* A code comment marks the wording as subject to your compliance review.

## What it needs

* **One database script:** the weekly email settings, the "featured" list, a log of what was sent to whom (so a program isn't repeated and nobody gets two in a week), and an unsubscribe token per realtor.
* **A small public unsubscribe page** (`/u/{token}`, like the Pages links) and the ghl function's bulk email to partners (the borrower bulk send already exists; partners can be texted one at a time since today).

## Connor's answers (2026-11-11)

1. **Who:** realtors in stages **Active** and **Nurture**, with email consent and no opt-out.
2. **Programs:** Connor **picks them each week** (no automatic suggestions). The weekly draft waits for his picks; the "Feature in the weekly email" button and the picker are the only way programs get in.
3. **Realtors only** for now; the closed-client weekly email (next-build decision 5) stays for later.
4. **When:** after Phase 9 (lender highlights), so its tags can show beside programs in the picker.
