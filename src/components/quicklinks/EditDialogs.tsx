import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, NumberInput, Select, confirmAction } from '@/components/shared'
import { removeLogoFile, useDeleteQuickLink, useSaveAriveLogin, useSaveLenderLink, useSaveQuickLink, type QuickLinkDraft } from '@/lib/api/quickLinks'
import { ariveLoginProblem, CATEGORY_LABELS, urlProblem, type PortalLender, type QuickLink, type QuickLinkCategory } from '@/lib/quicklinks/links'
import { LogoField } from './LogoImage'

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as QuickLinkCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))

/** Uploads made while a window was open; the ones not saved are removed when it closes. */
function useFreshUploads() {
  const [fresh, setFresh] = useState<string[]>([])
  return {
    add: (p: string) => setFresh((f) => [...f, p]),
    /** Removes the uploads that aren't `keep`, and the old logo when it was replaced. */
    cleanUp: async (keep: string | null, old?: string | null) => {
      for (const p of fresh) if (p !== keep) await removeLogoFile(p)
      if (old && old !== keep) await removeLogoFile(old)
    },
  }
}

/** Add or edit a quick link (owners and admins): name, address(es), logo, section, order, delete. */
export function QuickLinkDialog({ initial, organizationId, onClose }: { initial: QuickLinkDraft; organizationId: string; onClose: () => void }) {
  const [l, setL] = useState(initial)
  const save = useSaveQuickLink()
  const remove = useDeleteQuickLink()
  const uploads = useFreshUploads()
  const set = <K extends keyof QuickLinkDraft>(key: K) => (value: QuickLinkDraft[K]) => setL((s) => ({ ...s, [key]: value }))
  const county = l.category === 'county_tax'
  const urlError = urlProblem(l.url, true)
  const secondError = urlProblem(l.secondaryUrl)
  const cancel = async () => {
    await uploads.cleanUp(initial.logoPath)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{l.id ? `Edit ${initial.name}` : 'Add a link'}</DialogTitle>
          <DialogDescription>Everyone in the company sees this link. Only owners and admins can change it.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <Input label={county ? 'County' : 'Name'} value={l.name} onChange={set('name')} required span={2} />
          <Select label="Section" value={l.category} options={CATEGORY_OPTIONS} onChange={set('category')} span={2} />
          <Input label={county ? 'CAD (appraisal district)' : 'Web address'} value={l.url} onChange={set('url')} required placeholder="https://" span={4} error={l.url ? (urlError ?? undefined) : undefined} />
          {county && <Input label="Tax office" value={l.secondaryUrl ?? ''} onChange={(v) => set('secondaryUrl')(v || null)} placeholder="https://" span={4} hint="Blank hides the Tax office button" error={secondError ?? undefined} />}
          {!county && <Input label="Subtitle" value={l.subtitle ?? ''} onChange={(v) => set('subtitle')(v || null)} span={3} hint="Optional, shown under the name" />}
          <NumberInput label="Sort order" value={l.sortOrder} onChange={(v) => set('sortOrder')(v ?? 100)} hint="Lower shows first" span={county ? 4 : 1} />
          {!county && <LogoField name={l.name} value={l.logoPath} onChange={set('logoPath')} onUploaded={uploads.add} organizationId={organizationId} siteUrl={l.url} />}
        </FormGrid>
        <DialogFooter>
          {l.id && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={async () => {
                if (!(await confirmAction(`Delete ${initial.name}? It disappears for everyone, including anyone who pinned it.`, { confirmLabel: 'Delete link', destructive: true }))) return
                remove.mutate({ ...initial, id: initial.id! } as QuickLink, {
                  onSuccess: async () => {
                    await uploads.cleanUp(null)
                    toast.success(`${initial.name} deleted`)
                    onClose()
                  },
                  onError: (e) => toast.error(e.message),
                })
              }}
            >
              Delete link
            </Button>
          )}
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (!l.name.trim()) return toast.error('The link needs a name.')
              if (urlError || secondError) return toast.error(urlError ?? secondError)
              save.mutate(l, {
                onSuccess: async () => {
                  await uploads.cleanUp(l.logoPath, initial.logoPath)
                  toast.success(l.id ? 'Link saved' : 'Link added')
                  onClose()
                },
                onError: (e) => toast.error(e.message),
              })
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A lender tile's pencil (owners and admins): portal link, logo and show/hide.
 * Lenders are listed A–Z; everything else about a lender is on the Lenders page.
 */
export function LenderLinkDialog({ lender, organizationId, onClose }: { lender: PortalLender; organizationId: string; onClose: () => void }) {
  const [portalUrl, setPortalUrl] = useState(lender.portalUrl ?? '')
  const [logoPath, setLogoPath] = useState(lender.logoPath)
  const [shown, setShown] = useState(lender.showInQuickLinks !== false)
  const save = useSaveLenderLink()
  const uploads = useFreshUploads()
  const error = urlProblem(portalUrl)
  const ready = lender.showInQuickLinks !== undefined
  const cancel = async () => {
    await uploads.cleanUp(lender.logoPath)
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {lender.name}</DialogTitle>
          <DialogDescription>
            The same portal link and logo as the lender's window on the{' '}
            <Link to={`/admin/lenders?lender=${lender.id}`} className="underline">
              Lenders page
            </Link>
            , where you can also rename or delete the lender.
          </DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <Input label="Portal link" value={portalUrl} onChange={setPortalUrl} placeholder="https://" span={4} error={portalUrl ? (error ?? undefined) : undefined} hint="Blank takes the lender off Lender portals" />
          <LogoField name={lender.name} value={logoPath} onChange={setLogoPath} onUploaded={uploads.add} organizationId={organizationId} siteUrl={portalUrl || null} />
          {ready && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
              <input type="checkbox" className="size-4 accent-primary" checked={shown} onChange={(e) => setShown(e.target.checked)} />
              Show on Quick Links
            </label>
          )}
        </FormGrid>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (error) return toast.error(error)
              save.mutate(
                { id: lender.id, portalUrl: portalUrl || null, logoPath, ...(ready && { showInQuickLinks: shown }) },
                {
                  onSuccess: async () => {
                    await uploads.cleanUp(logoPath, lender.logoPath)
                    toast.success(`${lender.name} saved`)
                    onClose()
                  },
                  onError: (e) => toast.error(e.message),
                },
              )
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Set Arive URL" (owners and admins): the company's Arive login page. */
export function AriveLoginDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const [url, setUrl] = useState(current ?? '')
  const save = useSaveAriveLogin()
  const problem = ariveLoginProblem(url)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Arive login</DialogTitle>
          <DialogDescription>Your company's Arive sign-in page. It ends in .myarive.com. Also in Settings → Company.</DialogDescription>
        </DialogHeader>
        <Input label="Arive login address" value={url} onChange={setUrl} placeholder="https://yourcompany.myarive.com" error={url ? (problem ?? undefined) : undefined} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (problem) return toast.error(problem)
              save.mutate(url || null, {
                onSuccess: () => {
                  toast.success(url ? 'Arive login saved' : 'Arive login cleared')
                  onClose()
                },
                onError: (e) => toast.error(e.message),
              })
            }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
