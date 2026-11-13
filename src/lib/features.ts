// Features that are built but switched off for now (Connor). Turn one on by
// changing false to true here; nothing else needs to change, and the data
// each one uses is kept while it's off.

export const FEATURES = {
  /**
   * AI income review (Stage 4, put away 2026-11-13): the Income tab in the
   * file menu, and "Calculate income" on the Income tab and on analyzed
   * uploads. Off = hidden; ?tab=income still opens the tab, and saved
   * worksheets and Push to 1003 keep working. Upload analysis (Stage 3) stays on.
   */
  incomeReview: false,
} as const
