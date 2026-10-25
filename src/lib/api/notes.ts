import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'
import type { Note, NoteKind } from './types'

interface NoteRow {
  id: string
  contact_id: string
  loan_id: string | null
  kind: NoteKind
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
  author: { id: string; full_name: string | null; email: string } | null
}

const NOTE_SELECT = 'id, contact_id, loan_id, kind, body, pinned, created_at, updated_at, author:profiles!notes_author_id_fkey ( id, full_name, email )'

function toNote(r: NoteRow): Note {
  return {
    id: r.id,
    contactId: r.contact_id,
    loanId: r.loan_id,
    kind: r.kind,
    body: r.body,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: r.author ? { id: r.author.id, name: r.author.full_name || r.author.email } : null,
  }
}

/** All notes about a person, newest first, across every loan they've had. */
export function useNotes(contactId: string | undefined) {
  return useQuery({
    queryKey: keys.notes(contactId ?? ''),
    enabled: !!contactId,
    queryFn: async () => {
      const rows = unwrap<NoteRow[]>(
        await db().from('notes').select(NOTE_SELECT).eq('contact_id', contactId!).order('created_at', { ascending: false }),
      )
      return rows.map(toNote)
    },
  })
}

export function useAddNote(contactId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { loanId: string | null; kind: NoteKind; body: string }) => {
      unwrap(
        await db()
          .from('notes')
          .insert({ organization_id: organizationId, contact_id: contactId, loan_id: input.loanId, kind: input.kind, body: input.body.trim() })
          .select('id'),
      )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notes(contactId) }),
  })
}

export function useUpdateNote(contactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...changes }: { id: string; body?: string; pinned?: boolean; kind?: NoteKind }) => {
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('notes')
          .update({ ...changes, ...(changes.body !== undefined ? { body: changes.body.trim() } : {}) })
          .eq('id', id)
          .select('id'),
      )
      if (rows.length === 0) throw new Error('Only the author (or an owner/admin) can change this note.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notes(contactId) }),
  })
}

export function useDeleteNote(contactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('notes').delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('Only the author (or an owner/admin) can delete this note.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notes(contactId) }),
  })
}

/** The most recent call, text, email or meeting: what "Last contact" means. */
export function lastContact(notes: Note[] | undefined): Note | null {
  return notes?.find((n) => n.kind !== 'note') ?? null
}
