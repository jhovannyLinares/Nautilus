import { afterEach, describe, expect, it } from 'vitest'
import { en } from '@shared/i18n-en'
import { localeOf, setLocale, t, type TextKey } from '@shared/i18n'

const placeholdersOf = (text: string): string[] => (text.match(/\{\d+\}/g) ?? []).sort()

describe('idioma', () => {
  afterEach(() => setLocale('es'))

  it('español para cualquier variante de español; inglés para el resto', () => {
    expect(localeOf('es-MX')).toBe('es')
    expect(localeOf('ES')).toBe('es')
    expect(localeOf('en-US')).toBe('en')
    expect(localeOf('pt-BR')).toBe('en')
  })

  it('traduce y reemplaza parámetros en los dos idiomas', () => {
    expect(t('en {0} días', { 0: 12 })).toBe('en 12 días')
    setLocale('en-US')
    expect(t('en {0} días', { 0: 12 })).toBe('in 12 days')
    expect(t('Vencida')).toBe('Expired')
  })

  it('cada traducción lleva los mismos parámetros que el español', () => {
    const mismatched = (Object.keys(en) as TextKey[]).filter((key) => placeholdersOf(key).join() !== placeholdersOf(en[key]).join())
    expect(mismatched).toEqual([])
  })

  it('ninguna traducción queda vacía', () => {
    expect((Object.keys(en) as TextKey[]).filter((key) => en[key].trim() === '')).toEqual([])
  })
})
