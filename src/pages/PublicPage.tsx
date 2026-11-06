// /p/{slug}: a published page for anyone, no sign-in (Pages, 2026-11-06).
// Loaded on its own (outside the app shell) so it stays light on a phone.
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Loader2Icon } from 'lucide-react'
import { PageRenderer, SuccessScreen, emptyFormState, type FormState } from '@/components/pages/PageRenderer'
import { fetchPublicPage, publicAssetUrl, submitPage, uploadVisitorFile, type PublicPage as PublicPageData } from '@/lib/api/pages'
import { isSupabaseConfigured } from '@/lib/supabase'
import { MAX_FILE_BYTES, MAX_FILES_PER_FIELD, readSubmission, UPLOAD_TYPES } from '../../supabase/functions/page-submit/blocks'

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.content = content
}

/** UTM tags and where they came from, kept with the submission. */
function sourceParams(): Record<string, string> {
  const q = new URLSearchParams(window.location.search)
  const out: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = q.get(k)
    if (v) out[k] = v.slice(0, 300)
  }
  if (document.referrer && !document.referrer.startsWith(window.location.origin)) out.referrer = document.referrer.slice(0, 300)
  return out
}

export function PublicPage() {
  const { slug = '' } = useParams()
  const [page, setPage] = useState<PublicPageData | null | 'loading'>('loading')
  const [form, setForm] = useState<FormState>(emptyFormState)
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<{ title: string | null; message: string | null } | null>(null)
  // Made when the form opens: uploads go under it, and a double tap is saved once.
  const submissionId = useMemo(() => crypto.randomUUID(), [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setPage(null)
      return
    }
    let gone = false
    fetchPublicPage(slug, true)
      .then((p) => !gone && setPage(p ? { ...p, owner: p.owner ? { ...p.owner, photoPath: p.owner.photoPath ? publicAssetUrl(p.owner.photoPath) : null } : null } : null))
      .catch(() => !gone && setPage(null))
    return () => {
      gone = true
    }
  }, [slug])

  useEffect(() => {
    if (!page || page === 'loading') {
      if (page === null) document.title = 'Page not found · MPS Mortgage'
      return
    }
    const title = page.settings.seoTitle || `${page.title} · MPS Mortgage`
    const description = page.settings.seoDescription || 'MPS Mortgage LLC · NMLS #2501110 · Dallas-Fort Worth, Texas'
    document.title = title
    setMeta('description', description)
    setMeta('og:title', title, 'property')
    setMeta('og:description', description, 'property')
    if (page.settings.ogImage) setMeta('og:image', page.settings.ogImage, 'property')
  }, [page])

  if (page === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
      </div>
    )
  }
  if (!page) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">404</p>
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">This page isn't available. Check the link, or reach out to your loan officer.</p>
      </div>
    )
  }
  if (done) return <SuccessScreen page={page} title={done.title} message={done.message} />

  const onFiles = async (blockId: string, list: FileList) => {
    const already = form.files[blockId]?.length ?? 0
    const picked = Array.from(list).slice(0, Math.max(0, MAX_FILES_PER_FIELD - already))
    const bad = picked.find((f) => f.size > MAX_FILE_BYTES || !UPLOAD_TYPES.includes(f.type))
    if (bad) {
      setForm((s) => ({ ...s, errors: { ...s.errors, [blockId]: bad.size > MAX_FILE_BYTES ? 'Files can be up to 10 MB.' : 'Upload a PDF or a photo (JPG, PNG, HEIC).' } }))
      return
    }
    setForm((s) => ({ ...s, uploading: { ...s.uploading, [blockId]: true }, errors: { ...s.errors, [blockId]: '' } }))
    try {
      for (const f of picked) {
        const up = await uploadVisitorFile(page.slug, submissionId, blockId, f)
        setForm((s) => ({ ...s, files: { ...s.files, [blockId]: [...(s.files[blockId] ?? []), up] } }))
      }
    } catch (e) {
      setForm((s) => ({ ...s, errors: { ...s.errors, [blockId]: (e as Error).message } }))
    } finally {
      setForm((s) => ({ ...s, uploading: { ...s.uploading, [blockId]: false } }))
    }
  }

  const onSubmit = async () => {
    setFormError(null)
    // The same checks the server runs, so mistakes show right away.
    const check = readSubmission(page.blocks, form.answers, form.files, form.consent)
    const fieldErrors = Object.fromEntries(Object.entries(check.errors).filter(([k]) => k !== '_contact'))
    if (Object.keys(check.errors).length) {
      setForm((s) => ({ ...s, errors: fieldErrors }))
      setFormError(check.errors._contact ?? 'Please check the highlighted answers.')
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSubmitting(true)
    try {
      const r = await submitPage({ slug: page.slug, submissionId, answers: form.answers, files: form.files, consent: form.consent, source: sourceParams(), website: honeypot })
      if (r.redirectUrl && /^https:\/\//.test(r.redirectUrl)) {
        window.location.href = r.redirectUrl
        return
      }
      setDone({ title: r.successTitle, message: r.successMessage })
      window.scrollTo({ top: 0 })
    } catch (e) {
      const err = e as Error & { fields?: Record<string, string> }
      if (err.fields) setForm((s) => ({ ...s, errors: err.fields! }))
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageRenderer
      page={page}
      mode="live"
      form={form}
      onAnswer={(id, v) => {
        setFormError(null)
        setForm((s) => ({ ...s, answers: { ...s.answers, [id]: v }, errors: { ...s.errors, [id]: '' } }))
      }}
      onConsent={(v) => setForm((s) => ({ ...s, consent: v }))}
      onFiles={onFiles}
      onRemoveFile={(id, path) => setForm((s) => ({ ...s, files: { ...s.files, [id]: (s.files[id] ?? []).filter((f) => f.path !== path) } }))}
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
      honeypot={honeypot}
      onHoneypot={setHoneypot}
    />
  )
}
