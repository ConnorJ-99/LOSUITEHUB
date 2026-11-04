import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, ToggleChip } from '@/components/shared'
import {
  currentPushEndpoint,
  NOTIFICATION_KINDS,
  pushSupport,
  useNotificationSettings,
  usePushDevices,
  useSaveNotificationSettings,
  useSendTestNotification,
  useTurnOffPush,
  useTurnOnPush,
  wants,
  type NotificationPrefs,
} from '@/lib/api/notifications'
import { useAuth } from '@/lib/auth/context'
import { relativeTime } from '@/lib/dates'

/**
 * Settings → Notifications: per kind, in the app (the bell) and as a push to
 * your phone or computer; turn push on for this device (the browser asks
 * permission); the devices that get them; and a test.
 */
export function NotificationSettingsCard() {
  const { state } = useAuth()
  const isAdmin = state.status === 'signedIn' && state.user.role === 'admin'
  const settings = useNotificationSettings()
  const save = useSaveNotificationSettings()
  const devices = usePushDevices()
  const turnOn = useTurnOnPush()
  const turnOff = useTurnOffPush()
  const test = useSendTestNotification()
  const [here, setHere] = useState<string | null>(null)
  useEffect(() => {
    currentPushEndpoint()
      .then(setHere)
      .catch(() => setHere(null))
  }, [devices.data])

  const prefs = settings.data ?? {}
  const set = (kind: (typeof NOTIFICATION_KINDS)[number]['kind'], channel: 'in_app' | 'push', on: boolean) => {
    const next: NotificationPrefs = { ...prefs, [kind]: { in_app: wants(prefs, kind, 'in_app'), push: wants(prefs, kind, 'push'), [channel]: on } }
    save.mutate(next, { onError: (e) => toast.error(e.message) })
  }
  const support = pushSupport()
  const thisOn = !!here && (devices.data ?? []).some((d) => d.endpoint === here)

  return (
    <Card title="Notifications" description="What reaches you: the bell in MPS HQ, and a push to your phone or computer. Only yours.">
      <div className="space-y-4">
        <ul className="divide-y">
          {NOTIFICATION_KINDS.filter((k) => !k.adminsOnly || isAdmin).map((k) => (
            <li key={k.kind} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
              <span className="text-sm">{k.label}</span>
              <span className="flex gap-2">
                <ToggleChip label="In the app" pressed={wants(prefs, k.kind, 'in_app')} onChange={(on) => set(k.kind, 'in_app', on)} disabled={save.isPending || !settings.data} />
                <ToggleChip label="Push" pressed={wants(prefs, k.kind, 'push')} onChange={(on) => set(k.kind, 'push', on)} disabled={save.isPending || !settings.data} />
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Push on this device</p>
          {support === 'install_first' ? (
            <p className="text-xs text-muted-foreground">On an iPhone or iPad: tap Share → Add to Home Screen, open MPS HQ from the Home Screen, then come back here to turn it on.</p>
          ) : support === 'unsupported' ? (
            <p className="text-xs text-muted-foreground">This browser can't get notifications.</p>
          ) : support === 'blocked' ? (
            <p className="text-xs text-muted-foreground">Notifications are blocked for MPS HQ in this browser. Allow them in the browser's site settings, then reload.</p>
          ) : (
            <p className="text-xs text-muted-foreground">{thisOn ? 'On for this device.' : 'Off for this device. Your browser asks for permission when you turn it on.'}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!thisOn && (support === 'ok' || support === 'install_first') && (
              <Button size="sm" disabled={turnOn.isPending} onClick={() => turnOn.mutate(undefined, { onSuccess: () => toast.success('Push is on for this device'), onError: (e) => toast.error(e.message) })}>
                {turnOn.isPending ? 'Turning on…' : 'Turn on for this device'}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => toast.success('Test sent. Check the bell (and this device, if push is on).'), onError: (e) => toast.error(e.message) })}>
              Send a test notification
            </Button>
          </div>
          {(devices.data ?? []).length > 0 && (
            <ul className="space-y-1 text-sm">
              {devices.data!.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {d.device ?? 'A device'}
                    {d.endpoint === here && <span className="text-muted-foreground"> · this one</span>}
                    <span className="text-xs text-muted-foreground"> · {d.last_used_at ? `last push ${relativeTime(d.last_used_at)}` : `added ${relativeTime(d.created_at)}`}</span>
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={turnOff.isPending}
                    onClick={async () => {
                      if (!(await confirmAction(`Stop push notifications on ${d.device ?? 'this device'}?`, { confirmLabel: 'Turn off' }))) return
                      turnOff.mutate(d.endpoint, { onSuccess: () => toast.success('Push turned off for that device'), onError: (e) => toast.error(e.message) })
                    }}
                  >
                    Turn off
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
