// Starter templates for Pages (Connor, 2026-11-06): one click copies one into
// a new Draft page, which is then edited like any other. Block ids are made
// fresh on every copy.
import type { Block, PageSettings } from '../../../supabase/functions/page-submit/blocks'

export type PageType = 'form' | 'landing' | 'open_house'

export const PAGE_TYPE_LABEL: Record<PageType, string> = { form: 'Form', landing: 'Landing page', open_house: 'Open house' }

export interface PageTemplate {
  key: string
  title: string
  description: string
  type: PageType
  slug: string
  blocks: Omit<Block, 'id'>[]
  settings: PageSettings
}

const CREDIT = ['Below 620', '620–659', '660–699', '700–739', '740+', 'Not sure']
const TIMELINE = ['ASAP', 'In the next 3 months', '3–6 months', '6+ months', 'Just looking']

const contactFields: Omit<Block, 'id'>[] = [
  { type: 'divider' },
  { type: 'short_text', label: 'Full name', placeholder: 'First and last', required: true, mapsTo: 'full_name' },
  { type: 'email', label: 'Email', placeholder: 'you@email.com', required: true, mapsTo: 'email' },
  { type: 'phone', label: 'Mobile phone', placeholder: '(214) 555-0100', required: true, mapsTo: 'phone' },
]

const closing: Omit<Block, 'id'>[] = [{ type: 'lo_card' }, { type: 'footer' }]

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    key: 'prequal',
    title: 'Quick Pre-Qual',
    description: 'Goal, price range, credit, income type, timeline',
    type: 'form',
    slug: 'prequal',
    blocks: [
      { type: 'heading', text: "Let's see what you qualify for", hero: true },
      { type: 'text', text: "Two minutes, no credit pull. I'll text you within one business day." },
      { type: 'choice', label: 'Buying or refinancing?', options: ['Buying', 'Refinancing'], required: true, mapsTo: 'purpose' },
      { type: 'currency', label: 'Target purchase price', placeholder: '400,000', help: 'A ballpark is fine.', required: true, mapsTo: 'purchase_price' },
      { type: 'dropdown', label: 'Credit range', options: CREDIT, mapsTo: 'credit_score' },
      { type: 'choice', label: 'How are you paid?', options: ['W-2', 'Self-employed', '1099', 'Retired'], mapsTo: 'income_doc_type' },
      { type: 'dropdown', label: 'When do you want to buy?', options: TIMELINE, mapsTo: 'timeline' },
      ...contactFields,
      ...closing,
    ],
    settings: {
      submitLabel: 'See my options',
      successTitle: 'Got it — thanks!',
      successMessage: "I'm reviewing your answers now and will text you within one business day with what you qualify for.",
      tags: ['Pre-Qual Form'],
      consent: true,
      notify: true,
    },
  },
  {
    key: 'borrower-info',
    title: 'Borrower Info Request',
    description: 'A few details for your file; answers land as proposed updates',
    type: 'form',
    slug: 'info-request',
    blocks: [
      { type: 'heading', text: 'A few details for your file', hero: true },
      { type: 'text', text: 'This helps me keep your file moving. Anything you change here, I review before it goes on your file.' },
      ...contactFields.slice(1),
      { type: 'currency', label: 'Target purchase price', mapsTo: 'purchase_price' },
      { type: 'currency', label: 'Down payment', mapsTo: 'down_payment' },
      { type: 'choice', label: 'How are you paid?', options: ['W-2', 'Self-employed', '1099', 'Retired'], mapsTo: 'income_doc_type' },
      { type: 'short_text', label: 'Employer' },
      { type: 'yes_no', label: 'Are you a first-time homebuyer?' },
      { type: 'yes_no', label: 'Have you or your spouse served in the military?' },
      { type: 'long_text', label: 'Anything else I should know?' },
      ...closing,
    ],
    settings: { submitLabel: 'Send my details', successTitle: 'Thank you!', successMessage: "I've got your details and will review them with your file.", tags: ['Info Request'], consent: true, notify: true },
  },
  {
    key: 'document-upload',
    title: 'Document Upload',
    description: 'Secure upload for pay stubs, W-2s and statements',
    type: 'form',
    slug: 'upload',
    blocks: [
      { type: 'heading', text: 'Upload your documents', hero: true },
      { type: 'text', text: 'Files go straight to your loan officer. PDFs or photos, up to 10 MB each.' },
      ...contactFields.slice(1),
      { type: 'file', label: 'Pay stubs (last 30 days)' },
      { type: 'file', label: 'W-2s (last 2 years)' },
      { type: 'file', label: 'Bank statements (last 2 months)' },
      { type: 'long_text', label: 'Notes' },
      ...closing,
    ],
    settings: { submitLabel: 'Upload', successTitle: 'Got your documents', successMessage: "Thanks! I'll review them and reach out if anything else is needed.", tags: ['Document Upload'], consent: false, notify: true },
  },
  {
    key: 'refi-interest',
    title: 'Refi Interest',
    description: 'Current loan, goal and home value for a refinance check',
    type: 'landing',
    slug: 'refi-check',
    blocks: [
      { type: 'heading', text: 'Could a refinance help you?', hero: true },
      { type: 'text', text: "Tell me about your current loan and I'll look at your options. No credit pull." },
      { type: 'choice', label: 'What is your goal?', options: ['Lower my payment', 'Take cash out', 'Shorten my term', 'Remove mortgage insurance'], required: true },
      { type: 'currency', label: 'Estimated home value' },
      { type: 'currency', label: 'Current loan balance' },
      { type: 'currency', label: 'Cash you would like to take out', mapsTo: 'cash_out' },
      { type: 'dropdown', label: 'Credit range', options: CREDIT, mapsTo: 'credit_score' },
      ...contactFields,
      ...closing,
    ],
    settings: { submitLabel: 'Check my options', successTitle: 'Thanks!', successMessage: "I'll review your numbers and reach out within one business day.", tags: ['Refi Interest'], consent: true, notify: true },
  },
  {
    key: 'realtor-partner',
    title: 'Realtor Partner Sign-Up',
    description: 'Agents join your Partner center',
    type: 'form',
    slug: 'partners',
    blocks: [
      { type: 'heading', text: "Let's work together", hero: true },
      { type: 'text', text: 'Fast pre-approvals, clear updates and on-time closings for your buyers.' },
      { type: 'short_text', label: 'Full name', required: true, mapsTo: 'full_name' },
      { type: 'short_text', label: 'Brokerage', required: true },
      { type: 'email', label: 'Email', required: true, mapsTo: 'email' },
      { type: 'phone', label: 'Mobile phone', mapsTo: 'phone' },
      { type: 'dropdown', label: 'Buyers per year', options: ['1–5', '6–15', '16–30', '30+'] },
      { type: 'long_text', label: 'How can I help your business?' },
      ...closing,
    ],
    settings: { submitLabel: 'Sign me up', successTitle: 'Thanks for reaching out!', successMessage: "I'll be in touch this week to set up a quick call.", tags: ['Realtor Partner'], consent: true, notify: true, leadKind: 'partner' },
  },
  {
    key: 'callback',
    title: 'Contact / Callback',
    description: 'Name, phone and the best time to call',
    type: 'form',
    slug: 'callback',
    blocks: [
      { type: 'heading', text: 'Request a call', hero: true },
      { type: 'short_text', label: 'Full name', required: true, mapsTo: 'full_name' },
      { type: 'phone', label: 'Mobile phone', required: true, mapsTo: 'phone' },
      { type: 'email', label: 'Email', mapsTo: 'email' },
      { type: 'dropdown', label: 'Best time to call', options: ['Morning', 'Afternoon', 'Evening'] },
      { type: 'long_text', label: 'What can I help with?' },
      ...closing,
    ],
    settings: { submitLabel: 'Request a call', successTitle: 'Thanks!', successMessage: "I'll call you at the time you picked.", tags: ['Callback'], consent: true, notify: true },
  },
]

export const newBlockId = () => Math.random().toString(36).slice(2, 10)

/** A template's blocks with fresh ids, ready to save as a new Draft. */
export function fromTemplate(t: PageTemplate): Block[] {
  return t.blocks.map((b) => ({ ...b, id: newBlockId(), options: b.options ? [...b.options] : undefined }))
}

/** A blank page of each type. */
export function blankPage(type: PageType): { blocks: Block[]; settings: PageSettings } {
  return {
    blocks: [{ id: newBlockId(), type: 'heading', text: 'Page title', hero: true }, ...contactFields.map((b) => ({ ...b, id: newBlockId() })), ...closing.map((b) => ({ ...b, id: newBlockId() }))],
    settings: { submitLabel: 'Send', successTitle: 'Thanks!', successMessage: "I'll be in touch soon.", tags: [], consent: true, notify: true, leadKind: type === 'open_house' ? 'lead' : undefined },
  }
}
