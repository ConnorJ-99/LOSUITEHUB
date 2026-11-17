import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { isLogoUrl, normalizeUrl, type Pin, type PinType, type QuickLink, type QuickLinkCategory } from '@/lib/quicklinks/links'
import { db, keys, unwrap } from './client'

// Quick Links (Connor, 2026-11-17; 20270213000000_quick_links.sql). Everyone
// reads; owners and admins change links, lender portals and logos (Row Level
// Security refuses anyone else); each person keeps their own pins.

export const LOGO_BUCKET = 'logos'
export const MAX_LOGO_BYTES = 1024 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const quickLinksKey = ['quickLinks'] as const
const pinsKey = (userId: string) => ['pinnedLinks', userId] as const

/** True when the error means the quick links script hasn't run yet (missing table). */
const notInstalled = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? ''))

interface QuickLinkRow {
  id: string
  category: QuickLinkCategory
  name: string
  url: string
  secondary_url: string | null
  subtitle: string | null
  logo_path: string | null
  sort_order: number
}

const toLink = (r: QuickLinkRow): QuickLink => ({ id: r.id, category: r.category, name: r.name, url: r.url, secondaryUrl: r.secondary_url, subtitle: r.subtitle, logoPath: r.logo_path, sortOrder: r.sort_order })

/** Every quick link in the company. `ready` is false until the script has run. */
export function useQuickLinks() {
  return useQuery({
    queryKey: quickLinksKey,
    queryFn: async (): Promise<{ ready: boolean; links: QuickLink[] }> => {
      const { data, error } = await db().from('quick_links').select('*').order('sort_order').order('name')
      if (notInstalled(error)) return { ready: false, links: [] }
      if (error) throw new Error(error.message)
      return { ready: true, links: (data as QuickLinkRow[]).map(toLink) }
    },
  })
}

/** The signed-in person's own pins (Row Level Security shows no one else's). */
export function usePins() {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : ''
  return useQuery({
    queryKey: pinsKey(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Pin[]> => {
      const { data, error } = await db().from('user_pinned_links').select('id, link_type, link_id, sort_order').order('sort_order')
      if (notInstalled(error)) return []
      if (error) throw new Error(error.message)
      return (data as { id: string; link_type: PinType; link_id: string; sort_order: number }[]).map((r) => ({ id: r.id, linkType: r.link_type, linkId: r.link_id, sortOrder: r.sort_order }))
    },
  })
}

/** Star / unstar a tile. The star changes at once and goes back if saving fails. */
export function useTogglePin() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : ''
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ linkType, linkId, pin }: { linkType: PinType; linkId: string; pin: Pin | undefined }) => {
      if (pin) {
        unwrap(await db().from('user_pinned_links').delete().eq('id', pin.id))
        return
      }
      const { error } = await db()
        .from('user_pinned_links')
        .insert({ organization_id: orgId, link_type: linkType, ...(linkType === 'lender' ? { lender_id: linkId } : { quick_link_id: linkId }) })
      if (notInstalled(error)) throw new Error('Run the quick links script in Supabase first.')
      if (error && error.code !== '23505') throw new Error(error.message)
    },
    onMutate: async ({ linkType, linkId, pin }) => {
      await queryClient.cancelQueries({ queryKey: pinsKey(userId) })
      const before = queryClient.getQueryData<Pin[]>(pinsKey(userId))
      const list = before ?? []
      queryClient.setQueryData<Pin[]>(
        pinsKey(userId),
        pin ? list.filter((p) => p.id !== pin.id) : [...list, { id: `new-${linkId}`, linkType, linkId, sortOrder: Math.max(0, ...list.map((p) => p.sortOrder)) + 1 }],
      )
      return { before }
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData(pinsKey(userId), ctx?.before),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pinsKey(userId) }),
  })
}

export interface QuickLinkDraft {
  id: string | null
  category: QuickLinkCategory
  name: string
  url: string
  secondaryUrl: string | null
  subtitle: string | null
  logoPath: string | null
  sortOrder: number
}

/** Add or change a link (owners and admins). */
export function useSaveQuickLink() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (l: QuickLinkDraft) => {
      const row = {
        category: l.category,
        name: l.name.trim(),
        url: normalizeUrl(l.url),
        secondary_url: normalizeUrl(l.secondaryUrl),
        subtitle: l.subtitle?.trim() || null,
        logo_path: l.logoPath?.trim() || null,
        sort_order: Math.round(l.sortOrder),
      }
      const result = l.id ? await db().from('quick_links').update(row).eq('id', l.id).select('id') : await db().from('quick_links').insert({ ...row, organization_id: orgId }).select('id')
      if (result.error?.code === '23505') throw new Error(`There's already a link called ${row.name} in that section.`)
      if (result.error?.code === '42501' || (!result.error && !result.data?.length)) throw new Error('Only owners and admins can change links.')
      unwrap(result)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quickLinksKey }),
  })
}

/** Delete a link; everyone's pins of it go with it. */
export function useDeleteQuickLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (link: QuickLink) => {
      const { data, error } = await db().from('quick_links').delete().eq('id', link.id).select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) throw new Error('Only owners and admins can delete links.')
      if (link.logoPath && !isLogoUrl(link.logoPath)) await db().storage.from(LOGO_BUCKET).remove([link.logoPath])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickLinksKey })
      queryClient.invalidateQueries({ queryKey: ['pinnedLinks'] })
    },
  })
}

/** Change a lender's Quick Links fields only (portal, logo, show/hide). */
export function useSaveLenderLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...l }: { id: string; portalUrl?: string | null; logoPath?: string | null; showInQuickLinks?: boolean }) => {
      const row = {
        ...(l.portalUrl !== undefined && { portal_url: normalizeUrl(l.portalUrl) }),
        ...(l.logoPath !== undefined && { logo_path: l.logoPath?.trim() || null }),
        ...(l.showInQuickLinks !== undefined && { show_in_quick_links: l.showInQuickLinks }),
      }
      const rows = unwrap<{ id: string }[]>(await db().from('lenders').update(row).eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('Only owners and admins can change lenders.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.lenders })
      queryClient.invalidateQueries({ queryKey: keys.catalog })
    },
  })
}

/** Set the company's Arive login address (owners and admins). */
export function useSaveAriveLogin() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (url: string | null) => {
      const { data, error } = await db().from('organizations').update({ arive_login_url: normalizeUrl(url) }).eq('id', orgId!).select('id')
      if (error) throw new Error(/arive_login_url/.test(error.message) && /column/.test(error.message) ? 'Run the quick links script in Supabase first.' : error.message)
      if (!data?.length) throw new Error('Only owners and admins can set the Arive login.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.organization }),
  })
}

/** Why an image can't be a logo, or null when it's fine. */
export function logoFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return `${file.name} isn't a PNG, JPEG, WebP or GIF.`
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > MAX_LOGO_BYTES) return `${file.name} is over 1 MB. Save a smaller copy.`
  return null
}

/** Uploads a logo to the company's folder and returns its path (owners and admins). */
export async function uploadLogo(organizationId: string, file: File): Promise<string> {
  const problem = logoFileProblem(file)
  if (problem) throw new Error(problem)
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
  const path = `${organizationId}/${crypto.randomUUID()}.${ext}`
  const up = await db().storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw new Error(up.error.message.includes('Bucket not found') ? 'Run the quick links script in Supabase first.' : `Upload failed: ${up.error.message}`)
  return path
}

/** Removes an uploaded logo that's no longer used (pasted addresses are left alone). */
export async function removeLogoFile(path: string | null | undefined) {
  if (path && !isLogoUrl(path)) await db().storage.from(LOGO_BUCKET).remove([path])
}

/** Viewable addresses for uploaded logos (signed for an hour), by path. Pasted addresses are used as they are. */
export function useLogoImages(paths: (string | null | undefined)[]) {
  const files = [...new Set(paths.filter((p): p is string => !!p && !isLogoUrl(p)))].sort()
  return useQuery({
    queryKey: ['logoImages', files],
    enabled: files.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db().storage.from(LOGO_BUCKET).createSignedUrls(files, 3600)
      if (error) return new Map<string, string>()
      return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]))
    },
  })
}
