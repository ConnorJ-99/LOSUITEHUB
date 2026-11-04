import { useEffect, useRef, useState } from 'react'
import { Loader2Icon, MicIcon, SendIcon, SparklesIcon, SquareIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { confirmAction, ToggleChip } from '@/components/shared'
import { AssistantError, useAssistantThread, useClearThread, useSendToAssistant } from '@/lib/assistant/chat'
import { useAuth } from '@/lib/auth/context'
import { AssistantCardView } from './AssistantCards'
import { speechSupported, useSpeech } from './useSpeech'

const AUTO_SEND_KEY = 'mpshq.assistant.autoSend'
const readAutoSend = () => {
  try {
    return localStorage.getItem(AUTO_SEND_KEY) === '1'
  } catch {
    return false
  }
}

const EXAMPLES_FILE = ["What's this file's status?", 'Show me the Fee Estimates on this file', 'Add a task to call them tomorrow']
const EXAMPLES_ALL = ["Which leads haven't heard from me in 30 days?", 'Who closed in 2025?', 'My files under contract']

/**
 * The assistant's chat: the saved thread, cards, and a box to type or talk.
 * In a file (loanId) it knows the borrower; on the Assistant page it works
 * across every file you can see. `onNavigate` closes a panel when a card
 * opens another page.
 */
export function AssistantChat({ loanId, borrowerName, onNavigate, className }: { loanId: string | null; borrowerName: string | null; onNavigate?: () => void; className?: string }) {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const thread = useAssistantThread(loanId)
  const send = useSendToAssistant(loanId)
  const clear = useClearThread(loanId)
  const [text, setText] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ message: string; code: string | null } | null>(null)
  const [pending, setPending] = useState<{ text: string; voice: boolean } | null>(null)
  const [autoSend, setAutoSend] = useState(readAutoSend)
  const [voiceUsed, setVoiceUsed] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const messages = thread.data ?? []
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending, working])

  const submit = (raw: string, viaVoice = voiceUsed) => {
    const t = raw.trim()
    if (!t || send.isPending || !orgId) return
    setProblem(null)
    setPending({ text: t, voice: viaVoice })
    setText('')
    setVoiceUsed(false)
    send.mutate(
      { organizationId: orgId, loanId, borrowerName, history: messages, text: t, viaVoice, onWorking: setWorking },
      {
        onError: (e) => setProblem({ message: e.message, code: e instanceof AssistantError ? e.code : null }),
        onSettled: () => {
          setPending(null)
          setWorking(null)
        },
      },
    )
  }

  const speech = useSpeech(
    (heard) => {
      setText(heard)
      setVoiceUsed(true)
    },
    (heard) => {
      if (autoSend) submit(heard, true)
    },
  )
  const mic = () => {
    if (speech.listening) return speech.stop()
    if (!speechSupported() || !speech.start()) {
      box.current?.focus()
      toast.info("Voice isn't available in this browser. Tap the box and use your keyboard's microphone to dictate.")
    }
  }
  useEffect(() => {
    if (speech.error) toast.error(speech.error)
  }, [speech.error])

  const toggleAutoSend = (on: boolean) => {
    setAutoSend(on)
    try {
      localStorage.setItem(AUTO_SEND_KEY, on ? '1' : '0')
    } catch {
      // Not remembered in this browser.
    }
  }

  const empty = !thread.isPending && messages.length === 0 && !pending
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {thread.error && <p className="text-sm text-destructive">{thread.error.message}</p>}
        {empty && (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <SparklesIcon className="size-4 text-primary" />
              {loanId ? `Ask about ${borrowerName ?? 'this file'}, or tell it what to look up.` : 'Ask about any of your files.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {(loanId ? EXAMPLES_FILE : EXAMPLES_ALL).map((e) => (
                <Button key={e} size="sm" variant="outline" className="h-auto rounded-full py-1.5 whitespace-normal" onClick={() => submit(e, false)}>
                  {e}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
                {m.viaVoice && <p className="mb-0.5 flex items-center gap-1 text-xs opacity-80"><MicIcon className="size-3" />Voice</p>}
                {m.body}
              </div>
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              {m.body && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
              {m.cards.map((c, i) => (
                <AssistantCardView key={i} card={c} onChoose={(t) => submit(t, false)} onNavigate={onNavigate} />
              ))}
            </div>
          ),
        )}
        {pending && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-xl bg-primary px-3.5 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
              {pending.voice && <p className="mb-0.5 flex items-center gap-1 text-xs opacity-80"><MicIcon className="size-3" />Voice</p>}
              {pending.text}
            </div>
          </div>
        )}
        {working && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {working}
          </p>
        )}
        {problem && (
          <div className={cn('rounded-lg border px-3 py-2 text-sm', problem.code && ['no_key', 'bad_key', 'no_credit', 'busy'].includes(problem.code) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-destructive/30 bg-destructive/5 text-destructive')}>
            <p className="font-medium">{problem.code === 'no_key' ? 'API key not set' : problem.code === 'bad_key' ? 'API key refused' : problem.code === 'no_credit' ? 'Anthropic account out of credit' : problem.code === 'busy' ? 'Busy right now' : "That didn't work"}</p>
            <p>{problem.message}</p>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t bg-card px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit(text)
          }}
        >
          <Textarea
            ref={box}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (!e.target.value) setVoiceUsed(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit(text)
              }
            }}
            rows={1}
            placeholder={speech.listening ? 'Listening…' : 'Ask or tell it what to do…'}
            aria-label="Message to the assistant"
            className="max-h-36 min-h-10 flex-1 resize-none text-base md:text-sm"
          />
          <Button type="button" size="icon" variant={speech.listening ? 'default' : 'outline'} onClick={mic} aria-label={speech.listening ? 'Stop listening' : 'Talk'} title={speech.listening ? 'Stop listening' : 'Talk'}>
            {speech.listening ? <SquareIcon /> : <MicIcon />}
          </Button>
          <Button type="submit" size="icon" disabled={!text.trim() || send.isPending} aria-label="Send to the assistant">
            {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2">
          <ToggleChip label="Send when I stop talking" pressed={autoSend} onChange={toggleAutoSend} />
          {messages.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              disabled={clear.isPending || send.isPending}
              onClick={async () => {
                if (!(await confirmAction(loanId ? `Clear your assistant chat on ${borrowerName ?? 'this file'}? Nothing on the file changes.` : 'Clear your general assistant chat?', { confirmLabel: 'Clear chat' }))) return
                clear.mutate(undefined, { onError: (e) => toast.error(e.message) })
              }}
            >
              <Trash2Icon />
              Clear chat
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
