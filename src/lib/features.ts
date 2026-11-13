// Features that are built but switched off for now (Connor). Turn one on by
// changing false to true here; nothing else needs to change, and the data
// each one uses is kept while it's off.

export const FEATURES = {
  /**
   * AI income review (Stage 4, put away 2026-11-13): the Income tab in the
   * file menu, and "Calculate income" on the Income tab and on analyzed
   * uploads. Off = hidden; ?tab=income still opens the tab, and saved
   * worksheets and Push to 1003 keep working.
   */
  incomeReview: false,
  /**
   * AI review of uploaded documents (Stage 3b/3c, put away 2026-11-13): the
   * status, "Needs review", flags and "What it read" under each upload, Today's
   * "Upload analysis needs you", and the suggested conditions from upload flags.
   * Off = hidden. To also stop the reading (and its AI cost), pause the timer in
   * Supabase: select cron.unschedule('mpshq-document-analysis'); re-running
   * 20270118000000_document_analyses.sql turns it back on.
   */
  uploadReview: false,
  /**
   * The Loan Officer Assistant chat (put away 2026-11-13, to finish later): the
   * sidebar's Assistant, the Assistant tab on the right edge of a file and the
   * phone sparkle button. Off = hidden; /assistant still opens if typed. The
   * other AI features (contract reader, call notes, drafts) aren't affected.
   */
  assistant: false,
} as const
