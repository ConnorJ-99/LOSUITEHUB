// The assistant's "answer a guideline question" task (Product Search v2 step
// 9): the JSON shape, its instructions, and the checks on what comes back.
// Pure, with no imports, so the Edge Function (Deno) and the app share it.
//
// The assistant only sees passages the app found with full-text search (and
// the Edge Function reloads them itself, so their text can't be faked). Every
// answer quotes those passages word for word; a quote that isn't really in its
// passage is dropped, and an answer with no real quote becomes "the guidelines
// on file don't cover this".

export interface AnswerPassage {
  id: string
  lender: string
  document: string
  page: number
  section: string | null
  heading: string | null
  body: string
}

export interface Citation {
  passageId: string
  quote: string
}

export interface GuidelineAnswer {
  covered: boolean
  answer: string
  citations: Citation[]
}

/** The most passages sent with one question. */
export const MAX_PASSAGES = 10
/** Shown when nothing on file answers the question. */
export const NOT_COVERED = "The guidelines on file don't cover this. Check with the lender's scenario desk."

export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['covered', 'answer', 'citations'],
  properties: {
    covered: { type: 'boolean' },
    answer: { type: 'string' },
    citations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['passageId', 'quote'], properties: { passageId: { type: 'string' }, quote: { type: 'string' } } },
    },
  },
}

export const ANSWER_SYSTEM_PROMPT = `You answer a loan officer's question about mortgage lender guidelines, using only the guideline passages provided. You are not a source of guideline facts yourself.

Rules:
- Answer only from the passages. If they don't answer the question, set covered to false, leave citations empty and say briefly what the passages do cover, if anything. Never fill gaps from general knowledge.
- When covered, answer in 1 to 4 plain sentences, naming the lender for each point (lenders differ). Then cite every point.
- Each citation gives the passage id and a quote copied exactly, character for character, from that passage's text: a full sentence or the shortest phrase that proves the point, under 60 words. Don't paraphrase inside a quote.
- If the passages disagree or only partly answer, say so.
- No advice about whether to do the loan.`

/** The question plus the passages, each tagged with its id, lender, document and page. */
export function answerPrompt(question: string, passages: AnswerPassage[], scenario: string | null): string {
  const blocks = passages
    .map((p) => `<passage id="${p.id}" lender="${p.lender}" document="${p.document}" page="${p.page}"${p.section ? ` section="${p.section}"` : ''}>\n${p.heading ? `${p.heading}\n` : ''}${p.body}\n</passage>`)
    .join('\n\n')
  return `${scenario ? `The borrower's scenario: ${scenario}\n\n` : ''}<question>\n${question}\n</question>\n\n<passages>\n${blocks}\n</passages>`
}

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,:]$/, '')

/** Keeps only quotes really found in their passage; with none left, the answer is "not covered". */
export function normalizeAnswer(raw: unknown, passages: AnswerPassage[]): GuidelineAnswer | { error: string } {
  const r = raw as { covered?: unknown; answer?: unknown; citations?: unknown } | null
  if (!r || typeof r.answer !== 'string') return { error: 'The assistant returned no answer. Try again.' }
  const byId = new Map(passages.map((p) => [p.id, squash(`${p.heading ?? ''} ${p.body}`)]))
  const citations: Citation[] = []
  for (const c of Array.isArray(r.citations) ? r.citations : []) {
    const id = typeof c?.passageId === 'string' ? c.passageId : ''
    const quote = typeof c?.quote === 'string' ? c.quote.trim().replace(/^["“]|["”]$/g, '') : ''
    const text = byId.get(id)
    if (!text || squash(quote).length < 8 || !text.includes(squash(quote))) continue
    if (!citations.some((x) => x.passageId === id && x.quote === quote)) citations.push({ passageId: id, quote })
  }
  const answer = r.answer.trim()
  if (r.covered !== true || citations.length === 0) return { covered: false, answer: r.covered === true || !answer ? NOT_COVERED : `${NOT_COVERED} ${answer}`, citations: [] }
  return { covered: true, answer, citations }
}
