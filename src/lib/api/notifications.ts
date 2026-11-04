import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { db, unwrap } from './client'

// Notifications (Inbox fully live, Phase 2c, Connor 2026-11-03). The database
// makes them when something happens (a client replied, a message needs
// matching, a send failed, an opt-out, a scheduled send went or didn't); the
// app shows your own, marks them read, keeps your settings and turns phone
// push on for a device.

export type NotificationKind = 'reply' | 'needs_matching' | 'send_failed' | 'opted_out' | 'scheduled_sent' | 'scheduled_stopped' | 'test'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  createdAt: string
  readAt: string | null
}

/** The kinds people choose in Settings, with the push default. */
export const NOTIFICATION_KINDS: { kind: Exclude<NotificationKind, 'test'>; label: string; adminsOnly?: boolean; pushDefault: boolean }[] = [
  { kind: 'reply', label: 'A client texts or emails you', pushDefault: true },
  { kind: 'send_failed', label: 'A message you sent didn\'t go out', pushDefault: true },
  { kind: 'opted_out', label: 'A client opts out (STOP or unsubscribe)', pushDefault: true },
  { kind: 'scheduled_stopped', label: 'A scheduled message couldn\'t go at its time', pushDefault: true },
  { kind: 'scheduled_sent', label: 'A scheduled message went out', pushDefault: false },
  { kind: 'needs_matching', label: 'A message needs matching', adminsOnly: true, pushDefault: true },
]

export type NotificationPrefs = Partial<Record<NotificationKind, { in_app?: boolean; push?: boolean }>>

const nKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  settings: ['notifications', 'settings'] as const,
  devices: ['notifications', 'devices'] as const,
}

/** Your latest 40 notifications, newest first. */
export function useNotifications(enabled = true) {
  const { state } = useAuth()
  return useQuery({
    queryKey: nKeys.list,
    enabled: enabled && state.status === 'signedIn',
    queryFn: async (): Promise<AppNotification[]> => {
      const rows = unwrap<{ id: string; kind: NotificationKind; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }[]>(
        await db().from('notifications').select('id, kind, title, body, link, created_at, read_at').order('created_at', { ascending: false }).limit(40),
      )
      return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, readAt: r.read_at }))
    },
  })
}

/** How many of yours are unread (the bell's badge). */
export function useUnreadNotifications() {
  const { state } = useAuth()
  return useQuery({
    queryKey: nKeys.unread,
    enabled: state.status === 'signedIn',
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await db().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}

/** Marks these (or, with none given, all of yours) read. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids?: string[]) => unwrap<number>(await db().rpc('mark_notifications_read', { p_ids: ids ?? null })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nKeys.all }),
  })
}

/** A new notification arrives the moment it's made (Supabase Realtime; each person only receives their own). */
export function useNotificationsLive() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  useEffect(() => {
    if (!userId) return
    const channel = db()
      .channel(`notifications-live-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => queryClient.invalidateQueries({ queryKey: nKeys.all }))
      .subscribe()
    return () => {
      void db().removeChannel(channel)
    }
  }, [userId, queryClient])
}

/** Your choices per kind; missing = the defaults (everything in the app, push as NOTIFICATION_KINDS says). */
export function useNotificationSettings() {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: nKeys.settings,
    enabled: !!userId,
    queryFn: async (): Promise<NotificationPrefs> => {
      const row = unwrap<{ prefs: NotificationPrefs } | null>(await db().from('notification_settings').select('prefs').eq('user_id', userId!).maybeSingle())
      return row?.prefs ?? {}
    },
  })
}

export const wants = (prefs: NotificationPrefs, kind: Exclude<NotificationKind, 'test'>, channel: 'in_app' | 'push'): boolean => {
  const v = prefs[kind]?.[channel]
  if (typeof v === 'boolean') return v
  return channel === 'push' ? (NOTIFICATION_KINDS.find((k) => k.kind === kind)?.pushDefault ?? true) : true
}

export function useSaveNotificationSettings() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  return useMutation({
    mutationFn: async (prefs: NotificationPrefs) => {
      unwrap(await db().from('notification_settings').upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nKeys.settings }),
  })
}

export function useSendTestNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      unwrap(await db().rpc('send_test_notification'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nKeys.all }),
  })
}

/** The devices you turned push on for. */
export function usePushDevices() {
  const { state } = useAuth()
  return useQuery({
    queryKey: nKeys.devices,
    enabled: state.status === 'signedIn',
    queryFn: async () =>
      unwrap<{ id: string; endpoint: string; device: string | null; created_at: string; last_used_at: string | null }[]>(
        await db().from('push_subscriptions').select('id, endpoint, device, created_at, last_used_at').order('created_at', { ascending: false }),
      ),
  })
}

// ---------------------------------------------------------------------------
// Phone / computer push on this device
// ---------------------------------------------------------------------------

export type PushSupport = 'ok' | 'unsupported' | 'install_first' | 'blocked'

/** Whether this browser can get push now. iPhones and iPads only can once MPS HQ is added to the Home Screen. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'install_first' : 'unsupported'
  }
  if (!('PushManager' in window)) {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'install_first' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'blocked'
  return 'ok'
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'This device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  const installed = window.matchMedia?.('(display-mode: standalone)').matches ? ' (installed app)' : ''
  return `${browser} on ${os}${installed}`
}

/** This device's current push subscription, if any. */
export async function currentPushEndpoint(): Promise<string | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub?.endpoint ?? null
}

/** Asks permission (from a click), subscribes this device and saves it. */
export function useTurnOnPush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const support = pushSupport()
      if (support === 'install_first') throw new Error('On an iPhone or iPad, add MPS HQ to your Home Screen first (Share → Add to Home Screen), open it from there, then turn this on.')
      if (support === 'unsupported') throw new Error('This browser can\'t get notifications.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Notifications are blocked for MPS HQ in this browser. Allow them in the browser\'s site settings, then try again.')
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
      await navigator.serviceWorker.ready
      const { data, error } = await db().functions.invoke<{ publicKey?: string; error?: string }>('push', { body: { task: 'public_key' } })
      if (error || !data?.publicKey) throw new Error('Phone notifications aren\'t set up on the server yet (the push function and its keys).')
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) as BufferSource }))
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('This browser didn\'t give a usable subscription.')
      unwrap(await db().rpc('save_push_subscription', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_device: deviceLabel() }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nKeys.devices }),
  })
}

/** Stops push on a device (this one, or one listed in Settings). */
export function useTurnOffPush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (endpoint: string) => {
      unwrap(await db().rpc('remove_push_subscription', { p_endpoint: endpoint }))
      const here = await currentPushEndpoint().catch(() => null)
      if (here === endpoint) {
        const reg = await navigator.serviceWorker.getRegistration()
        await (await reg?.pushManager.getSubscription())?.unsubscribe()
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: nKeys.devices }),
  })
}
