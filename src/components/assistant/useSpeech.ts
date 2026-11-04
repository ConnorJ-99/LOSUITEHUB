import { useCallback, useEffect, useRef, useState } from 'react'

// Voice to text with the browser's own Web Speech API (Chrome, Edge, Safari).
// Where it isn't available, the phone keyboard's dictation mic does the job.

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

const Ctor = (): (new () => Recognition) | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = () => Ctor() !== null

/**
 * Listens once: `onText` gets the words as they're heard; `onDone` gets the
 * final words when you stop talking (or tap the mic again).
 */
export function useSpeech(onText: (text: string) => void, onDone: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const heard = useRef('')
  const started = useRef(0)
  const handlers = useRef({ onText, onDone })
  useEffect(() => {
    handlers.current = { onText, onDone }
  })

  const stop = useCallback(() => rec.current?.stop(), [])
  const start = useCallback(() => {
    const C = Ctor()
    if (!C) return false
    setError(null)
    heard.current = ''
    const r = new C()
    r.lang = 'en-US'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => {
      heard.current = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      handlers.current.onText(heard.current)
    }
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'The microphone is blocked for MPS HQ. Allow it in the browser settings.' : e.error === 'no-speech' ? 'Didn\'t catch that. Try again.' : null)
    r.onend = () => {
      setListening(false)
      rec.current = null
      if (heard.current) handlers.current.onDone(heard.current)
    }
    rec.current = r
    started.current = Date.now()
    r.start()
    setListening(true)
    return true
  }, [])

  useEffect(() => () => rec.current?.stop(), [])
  /** Seconds since listening started (for "Voice · 0:18"). */
  const seconds = () => Math.round((Date.now() - started.current) / 1000)
  return { listening, error, start, stop, seconds }
}
