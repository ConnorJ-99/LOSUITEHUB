import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'

// The company logo and each user's signature image (Settings), in the private
// brand-files bucket: <organization>/logo/<file> and
// <organization>/signatures/<user>/<file>. Used on PDFs.

export const BRAND_BUCKET = 'brand-files'
export const MAX_BRAND_BYTES = 2 * 1024 * 1024
/** What the PDF maker can draw. */
export const BRAND_TYPES = ['image/png', 'image/jpeg']

/** Why an image can't be used, or null when it's fine. */
export function brandFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (!BRAND_TYPES.includes(file.type)) return `${file.name} isn't a PNG or JPEG. Save it as PNG (best for a signature or logo).`
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > MAX_BRAND_BYTES) return `${file.name} is over 2 MB. Save a smaller copy.`
  return null
}

/** Where an image goes: the company's logo folder, or the user's own signature folder. */
export function brandPath(organizationId: string, kind: 'logo' | 'signature', userId: string, fileName: string, id: string = crypto.randomUUID()): string {
  const ext = /\.jpe?g$/i.test(fileName) ? 'jpg' : 'png'
  return kind === 'logo' ? `${organizationId}/logo/${id}.${ext}` : `${organizationId}/signatures/${userId}/${id}.${ext}`
}

type BrandTarget = { kind: 'logo'; organizationId: string; userId: string; current: string | null } | { kind: 'signature'; organizationId: string; userId: string; current: string | null }

/** Uploads a new logo or signature, points the company or profile at it, then removes the old file. */
export function useUploadBrandImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ target, file }: { target: BrandTarget; file: File }) => {
      const problem = brandFileProblem(file)
      if (problem) throw new Error(problem)
      const path = brandPath(target.organizationId, target.kind, target.userId, file.name)
      const up = await db().storage.from(BRAND_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error(up.error.message.includes('Bucket not found') ? 'Run the brand files script in Supabase first.' : `Upload failed: ${up.error.message}`)
      const saved =
        target.kind === 'logo'
          ? await db().from('organizations').update({ logo_path: path }).eq('id', target.organizationId).select('id')
          : await db().from('profiles').update({ signature_path: path }).eq('id', target.userId).select('id')
      if (saved.error || !saved.data?.length) {
        await db().storage.from(BRAND_BUCKET).remove([path])
        throw new Error(saved.error?.message ?? (target.kind === 'logo' ? 'Only owners and admins can change the logo.' : 'You can only change your own signature.'))
      }
      if (target.current) await db().storage.from(BRAND_BUCKET).remove([target.current])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.organization })
      queryClient.invalidateQueries({ queryKey: keys.myProfile })
    },
  })
}

/** Stops using the logo (back to the built-in one) or the signature, and deletes the file. */
export function useRemoveBrandImage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (target: BrandTarget) => {
      if (!target.current) return
      unwrap(
        target.kind === 'logo'
          ? await db().from('organizations').update({ logo_path: null }).eq('id', target.organizationId).select('id')
          : await db().from('profiles').update({ signature_path: null }).eq('id', target.userId).select('id'),
      )
      await db().storage.from(BRAND_BUCKET).remove([target.current])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.organization })
      queryClient.invalidateQueries({ queryKey: keys.myProfile })
    },
  })
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** A brand image as a data URL (for previews and PDFs), or null when there's none. */
export function useBrandImage(path: string | null | undefined) {
  return useQuery({
    queryKey: keys.brandImage(path ?? ''),
    enabled: !!path,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await db().storage.from(BRAND_BUCKET).download(path!)
      if (error || !data) throw new Error(error?.message ?? 'Could not load the image.')
      return asDataUrl(data)
    },
  })
}
