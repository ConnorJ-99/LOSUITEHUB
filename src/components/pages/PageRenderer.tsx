// Draws a page from its blocks: the builder's live preview (click a block to
// select it) and the public /p/{slug} page (a working form). One component,
// so the preview is exactly what visitors see. MPS-HQ colors (navy band, one
// accent blue), mobile-first.
import type * as React from 'react'
import { CheckIcon, FileUpIcon, Loader2Icon, MailIcon, PhoneIcon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import logo from '@/assets/mps-logo.png'
import { formatPhone } from '@/lib/pipeline/helpers'
import { isField, isSafeHref, type Block, type PageSettings, type UploadedFile } from '../../../supabase/functions/page-submit/blocks'
import type { PublicPage } from '@/lib/api/pages'
import { readProperty } from '@/lib/pages/openHouse'
import { FinancingCard, LoAndAgentCards, OpenHouseHeader } from './OpenHouse'

export const CONSENT_TEXT = 'I agree MPS Mortgage may contact me by call, text or email about my request. Msg & data rates may apply. Reply STOP to opt out.'

export interface FormState {
  answers: Record<string, unknown>
  files: Record<string, UploadedFile[]>
  consent: boolean
  errors: Record<string, string>
  uploading: Record<string, boolean>
}

export const emptyFormState = (): FormState => ({ answers: {}, files: {}, consent: false, errors: {}, uploading: {} })

interface Props {
  page: Pick<PublicPage, 'blocks' | 'settings' | 'owner' | 'company' | 'title'> & Partial<Pick<PublicPage, 'type' | 'property' | 'agent'>>
  /** live: a working form. preview: the builder (inputs don't type; blocks select). */
  mode: 'live' | 'preview'
  form?: FormState
  onAnswer?: (blockId: string, value: unknown) => void
  onConsent?: (value: boolean) => void
  onFiles?: (blockId: string, files: FileList) => void
  onRemoveFile?: (blockId: string, path: string) => void
  onSubmit?: () => void
  submitting?: boolean
  formError?: string | null
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** The honeypot's value (live only). */
  honeypot?: string
  onHoneypot?: (v: string) => void
  /** Desktop preview: a wider column. */
  wide?: boolean
  /** A line at the top of the form (a personal link's note). */
  notice?: string | null
}

const inputClass = 'h-12 w-full rounded-lg border border-input bg-white px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-destructive'

function BrandBar() {
  return (
    <div className="flex items-center gap-2.5">
      <img src={logo} alt="" className="size-8 rounded-md bg-white object-contain p-0.5" />
      <span className="text-[15px] font-bold text-white">MPS Mortgage</span>
    </div>
  )
}

function LoCard({ owner }: { owner: PublicPage['owner'] }) {
  const first = owner?.name?.split(/\s+/)[0] ?? 'Your loan officer'
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-soft">
      {owner?.photoPath ? (
        <img src={owner.photoPath} alt={owner.name ?? ''} className="size-16 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">{(owner?.name ?? 'LO').split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</div>
      )}
      <div className="min-w-0 text-sm">
        <p className="text-base font-bold">{owner?.name ?? 'Your loan officer'} · Loan Officer</p>
        {owner?.nmls && <p className="text-muted-foreground">NMLS #{owner.nmls}</p>}
        <div className="mt-0.5 flex flex-wrap gap-x-3">
          {owner?.phone && (
            <a href={`tel:${owner.phone}`} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">
              <PhoneIcon className="size-3.5" />
              Call or text {first}
            </a>
          )}
          {owner?.email && (
            <a href={`mailto:${owner.email}`} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">
              <MailIcon className="size-3.5" />
              Email
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export function Footer({ company, listing }: { company: PublicPage['company']; listing?: boolean }) {
  return (
    <p className="px-2 text-center text-xs leading-relaxed text-muted-foreground">
      {company?.name ?? 'MPS Mortgage LLC'} · NMLS #{company?.nmls ?? '2501110'} · Equal Housing Opportunity.
      <br />
      This is not a commitment to lend.
      {listing && (
        <>
          <br />
          Listing information deemed reliable but not guaranteed.
        </>
      )}
    </p>
  )
}

function Pill({ selected, onClick, children, kind, disabled }: { selected: boolean; onClick?: () => void; children: React.ReactNode; kind: 'radio' | 'check'; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-12 items-center gap-2.5 rounded-xl border px-4 text-base transition-colors',
        selected ? 'border-primary bg-primary/10 font-semibold text-primary ring-1 ring-primary' : 'border-input bg-white hover:border-primary/50',
        disabled && 'pointer-events-none',
      )}
    >
      <span className={cn('flex size-4 shrink-0 items-center justify-center border', kind === 'radio' ? 'rounded-full' : 'rounded', selected ? 'border-primary bg-primary text-white' : 'border-muted-foreground/50')}>
        {selected && (kind === 'radio' ? <span className="size-1.5 rounded-full bg-white" /> : <CheckIcon className="size-3" />)}
      </span>
      {children}
    </button>
  )
}

function FieldBlock({ b, mode, form, onAnswer, onFiles, onRemoveFile }: { b: Block } & Pick<Props, 'mode' | 'form' | 'onAnswer' | 'onFiles' | 'onRemoveFile'>) {
  const live = mode === 'live'
  const value = form?.answers[b.id]
  const error = form?.errors[b.id]
  const set = (v: unknown) => onAnswer?.(b.id, v)
  const label = b.label || 'Untitled question'
  const id = `f-${b.id}`
  const options = (b.options ?? []).filter((o) => o.trim())
  let control: React.ReactNode
  switch (b.type) {
    case 'long_text':
      control = <textarea id={id} rows={4} readOnly={!live} placeholder={b.placeholder} value={String(value ?? '')} onChange={(e) => set(e.target.value)} aria-invalid={!!error} className={cn(inputClass, 'h-auto py-3')} />
      break
    case 'dropdown':
      control = (
        <select id={id} disabled={!live} value={String(value ?? '')} onChange={(e) => set(e.target.value)} aria-invalid={!!error} className={cn(inputClass, 'appearance-auto disabled:opacity-100')}>
          <option value="">{b.placeholder || 'Select one'}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
      break
    case 'choice':
      control = (
        <div className={cn('gap-2.5', options.length === 2 ? 'grid grid-cols-2' : 'flex flex-wrap')}>
          {options.map((o) => (
            <Pill key={o} kind="radio" disabled={!live} selected={value === o} onClick={() => set(value === o ? '' : o)}>
              {o}
            </Pill>
          ))}
        </div>
      )
      break
    case 'checkboxes': {
      const list = Array.isArray(value) ? (value as string[]) : []
      control = (
        <div className="flex flex-wrap gap-2.5">
          {options.map((o) => (
            <Pill key={o} kind="check" disabled={!live} selected={list.includes(o)} onClick={() => set(list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}>
              {o}
            </Pill>
          ))}
        </div>
      )
      break
    }
    case 'yes_no':
      control = (
        <div className="grid grid-cols-2 gap-2.5">
          {['Yes', 'No'].map((o) => (
            <Pill key={o} kind="radio" disabled={!live} selected={value === o.toLowerCase()} onClick={() => set(value === o.toLowerCase() ? '' : o.toLowerCase())}>
              {o}
            </Pill>
          ))}
        </div>
      )
      break
    case 'file': {
      const files = form?.files[b.id] ?? []
      control = (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.path} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="truncate">{f.name}</span>
              {live && (
                <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${f.name}`} onClick={() => onRemoveFile?.(b.id, f.path)}>
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
          ))}
          <label className={cn('flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 text-base font-semibold text-primary', !live && 'pointer-events-none')}>
            {form?.uploading[b.id] ? <Loader2Icon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
            {form?.uploading[b.id] ? 'Uploading…' : files.length ? 'Add another file' : 'Choose a file or take a photo'}
            <input
              id={id}
              type="file"
              className="sr-only"
              accept="application/pdf,image/*"
              multiple
              disabled={!live || form?.uploading[b.id]}
              onChange={(e) => {
                if (e.target.files?.length) onFiles?.(b.id, e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )
      break
    }
    default: {
      const type = b.type === 'email' ? 'email' : b.type === 'phone' ? 'tel' : b.type === 'date' ? 'date' : 'text'
      const inputMode = b.type === 'currency' || b.type === 'number' ? 'decimal' : b.type === 'phone' ? 'tel' : undefined
      const autoComplete = b.mapsTo === 'full_name' ? 'name' : b.mapsTo === 'email' ? 'email' : b.mapsTo === 'phone' ? 'tel' : b.mapsTo === 'first_name' ? 'given-name' : b.mapsTo === 'last_name' ? 'family-name' : undefined
      const input = (
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          readOnly={!live}
          placeholder={b.type === 'currency' && b.placeholder ? b.placeholder.replace(/^\$\s*/, '') : b.placeholder}
          value={String(value ?? '')}
          onChange={(e) => set(e.target.value)}
          onBlur={(e) => {
            if (b.type === 'phone' && /^\d{10}$/.test(e.target.value.replace(/\D/g, ''))) set(formatPhone(e.target.value.replace(/\D/g, '')))
            if (b.type === 'currency') {
              const n = Number(e.target.value.replace(/[$,\s]/g, ''))
              if (e.target.value && Number.isFinite(n)) set(n.toLocaleString('en-US'))
            }
          }}
          aria-invalid={!!error}
          className={cn(inputClass, b.type === 'currency' && 'pl-8')}
        />
      )
      control =
        b.type === 'currency' ? (
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-base text-muted-foreground">$</span>
            {input}
          </div>
        ) : (
          input
        )
    }
  }
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
        {b.required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {control}
      {b.help && <p className="text-sm text-muted-foreground">{b.help}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}

function ContentBlock({ b }: { b: Block }) {
  switch (b.type) {
    case 'heading':
      return <h2 className="text-2xl leading-tight font-bold tracking-tight">{b.text || 'Heading'}</h2>
    case 'text':
      return <p className="text-base leading-relaxed whitespace-pre-line text-muted-foreground">{b.text || 'Text'}</p>
    case 'image':
      return b.url ? <img src={b.url} alt={b.alt ?? ''} className="w-full rounded-xl object-cover" /> : <div className="flex h-36 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">Image</div>
    case 'button':
      return (
        <a href={isSafeHref(b.href) ? b.href : undefined} target={b.href?.startsWith('https') ? '_blank' : undefined} rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl border-2 border-primary px-4 text-base font-semibold text-primary hover:bg-primary/5">
          {b.text || 'Button'}
        </a>
      )
    case 'divider':
      return <hr className="border-border" />
    default:
      return null
  }
}

/** The page. Blocks before the LO card and footer go in the white card; those two go below it. */
export function PageRenderer(props: Props) {
  const { page, mode, form, selectedId, onSelect, wide } = props
  const live = mode === 'live'
  const settings: PageSettings = page.settings ?? {}
  const blocks = page.blocks ?? []
  const heroIdx = blocks.findIndex((b) => b.type === 'heading' && b.hero)
  const heroText = heroIdx >= 0 && blocks[heroIdx + 1]?.type === 'text' ? blocks[heroIdx + 1] : null
  const inBand = new Set([heroIdx >= 0 ? blocks[heroIdx].id : '', heroText?.id ?? ''])
  const main = blocks.filter((b) => !inBand.has(b.id) && b.type !== 'lo_card' && b.type !== 'footer')
  const after = blocks.filter((b) => b.type === 'lo_card' || b.type === 'footer')
  const hasFields = blocks.some((b) => isField(b.type))
  const openHouse = page.type === 'open_house' ? readProperty(page.property) : null

  const wrap = (b: Block, node: React.ReactNode) =>
    live || !onSelect ? (
      <div key={b.id}>{node}</div>
    ) : (
      <div
        key={b.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(b.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(b.id)}
        className={cn('-m-2 cursor-pointer rounded-xl p-2 outline-none', selectedId === b.id ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40')}
      >
        {node}
      </div>
    )

  return (
    <div className="min-h-full bg-background">
      {openHouse && (
        <div className={cn('mx-auto', wide ? 'max-w-2xl' : 'max-w-lg')}>
          <OpenHouseHeader property={openHouse} />
        </div>
      )}
      <div className={cn('bg-navy px-5 pt-5 pb-14 text-white', openHouse && 'hidden')}>
        <div className={cn('mx-auto', wide ? 'max-w-2xl' : 'max-w-lg')}>
          <BrandBar />
          {heroIdx >= 0 &&
            wrap(
              blocks[heroIdx],
              <h1 className="mt-6 text-[32px] leading-[1.1] font-bold tracking-tight">{blocks[heroIdx].text || 'Heading'}</h1>,
            )}
          {heroText && wrap(heroText, <p className="mt-3 text-base leading-relaxed text-white/80">{heroText.text}</p>)}
        </div>
      </div>
      <div className={cn('mx-auto space-y-4 px-3 pb-8', openHouse ? 'mt-4' : '-mt-8', wide ? 'max-w-2xl' : 'max-w-lg')}>
        {openHouse && <FinancingCard property={openHouse} />}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (live) props.onSubmit?.()
          }}
          className="space-y-6 rounded-2xl border bg-white p-5 shadow-soft"
        >
          {props.notice && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{props.notice}</p>}
          {main.map((b) => wrap(b, isField(b.type) ? <FieldBlock b={b} mode={mode} form={form} onAnswer={props.onAnswer} onFiles={props.onFiles} onRemoveFile={props.onRemoveFile} /> : <ContentBlock b={b} />))}
          {hasFields && (
            <>
              {/* The honeypot: hidden from people, tempting to bots. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={props.honeypot ?? ''} onChange={(e) => props.onHoneypot?.(e.target.value)} name="website" />
                </label>
              </div>
              {settings.consent !== false && (
                <label className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
                  <input type="checkbox" disabled={!live} checked={!!form?.consent} onChange={(e) => props.onConsent?.(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]" />
                  {CONSENT_TEXT}
                </label>
              )}
              {props.formError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{props.formError}</p>}
              <button type="submit" disabled={!live || props.submitting || Object.values(form?.uploading ?? {}).some(Boolean)} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-lg font-semibold text-primary-foreground disabled:opacity-70">
                {props.submitting && <Loader2Icon className="size-5 animate-spin" />}
                {settings.submitLabel || 'Send'}
              </button>
            </>
          )}
        </form>
        {after.map((b) =>
          wrap(
            b,
            b.type === 'footer' ? (
              <Footer company={page.company} listing={!!openHouse} />
            ) : openHouse ? (
              <LoAndAgentCards owner={page.owner} agent={page.agent ?? null} agentPhotoUrl={openHouse.agentPhotoUrl} company={page.company} />
            ) : (
              <LoCard owner={page.owner} />
            ),
          ),
        )}
      </div>
    </div>
  )
}

/** The thank-you screen (mockup "Form submitted"). */
export function SuccessScreen({ page, title, message }: { page: Pick<PublicPage, 'owner' | 'company'>; title: string | null; message: string | null }) {
  const first = page.owner?.name?.split(/\s+/)[0]
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <div className="bg-navy px-5 py-5">
        <div className="mx-auto max-w-lg">
          <BrandBar />
        </div>
      </div>
      <div className="mx-auto w-full max-w-lg flex-1 space-y-6 px-5 py-10 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/10">
          <CheckIcon className="size-9 text-primary" strokeWidth={2.5} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{title || 'Got it — thanks!'}</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{message || "I'll be in touch soon."}</p>
        <div className="space-y-3 pt-2">
          {page.owner?.bookingUrl && (
            <a href={page.owner.bookingUrl} target="_blank" rel="noreferrer" className="flex min-h-13 items-center justify-center rounded-xl bg-primary px-4 text-lg font-semibold text-primary-foreground">
              Book a 15-minute call
            </a>
          )}
          {page.owner?.phone && (
            <a href={`sms:${page.owner.phone}`} className="flex min-h-13 items-center justify-center rounded-xl border bg-white px-4 text-lg font-semibold">
              Text {first ?? 'me'} now
            </a>
          )}
        </div>
      </div>
      <div className="pb-6">
        <Footer company={page.company} />
      </div>
    </div>
  )
}
