import { en } from './i18n-en'

/** La clave de cada texto es el propio texto en español: es el idioma de referencia y no necesita diccionario. */
export type TextKey = keyof typeof en
type Locale = 'es' | 'en'

export function localeOf(languageTag: string): Locale {
  return languageTag.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function detectedLocale(): Locale {
  const languageTag = typeof navigator === 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : navigator.language
  return localeOf(languageTag)
}

let locale = detectedLocale()

/** El proceso principal lo llama con `app.getLocale()`, que solo existe cuando la app ya arrancó. */
export function setLocale(languageTag: string): void {
  locale = localeOf(languageTag)
}

export function t(key: TextKey, params: Record<number, string | number> = {}): string {
  const text: string = locale === 'en' ? en[key] : key
  return text.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(params[Number(index)] ?? placeholder))
}
