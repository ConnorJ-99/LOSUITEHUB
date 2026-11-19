// Spotting a client's text in Spanish (Connor, 2026-11-18), so the thread can
// offer "Reveal translation" next to it. Done in code from common words, no AI
// call: the translation itself runs only when the button is pressed.

/** Words that are common in Spanish and not English words (so "no", "me", "a" aren't here). */
const SPANISH = new Set(
  (
    'que qué de del la el los las por para con una uno unos unas es está están estoy estamos tengo tiene tenemos gracias hola sí pero cuando cuándo como cómo ' +
    'puedo puede podemos necesito necesitamos quiero queremos casa buenos buenas días tardes noches usted ustedes muy bien también hay mañana hoy ayer ' +
    'cuánto cuánta dónde donde porque pues entonces ahora todavía nada algo eso esto este esta ese esa sus nuestro nuestra mis tus favor perdón disculpe ' +
    'señor señora préstamo pago dinero banco trabajo hablar llamar llamada mensaje enviar documentos crédito comprar vender listo claro saludos'
  ).split(' '),
)

/** Common English words, to weigh against. */
const ENGLISH = new Set(
  (
    'the and is are was were you your i we they he she it to of in for on with at this that have has had will would can could ' +
    'what when where how why do does did not yes thanks thank hi hello please just get got about from my our me be been'
  ).split(' '),
)

const words = (text: string) => text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? []

/** True when a message reads as Spanish: ¿ or ¡, or more Spanish words than English (at least 2, or 1 in a very short text). */
export function looksSpanish(text: string | null | undefined): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (/[¿¡]/.test(t)) return true
  const w = words(t)
  if (!w.length) return false
  const es = w.filter((x) => SPANISH.has(x)).length + (/[ñ]|[áéíóú]/.test(t) ? 1 : 0)
  const en = w.filter((x) => ENGLISH.has(x)).length
  if (es <= en) return false
  return es >= 2 || (w.length <= 3 && es >= 1)
}
