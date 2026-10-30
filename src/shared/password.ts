import { t } from './i18n'
/** Generador de contraseñas del diálogo de variable. Sin dependencias: lo usan el renderer y los tests. */

export type CharClassId = 'upper' | 'lower' | 'digits' | 'symbols'

export interface CharClass {
  id: CharClassId
  label: string
  sample: string
  chars: string
}

/**
 * Los símbolos se limitan a los que no rompen la variable en cmd, en un .bat ni en PowerShell:
 * `% ! ^ & | < > " ' $` y el acento grave tienen significado especial en alguno de los tres.
 */
export const CHAR_CLASSES: readonly CharClass[] = [
  { id: 'upper', label: t('Mayúsculas'), sample: 'A-Z', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { id: 'lower', label: t('Minúsculas'), sample: 'a-z', chars: 'abcdefghijklmnopqrstuvwxyz' },
  { id: 'digits', label: t('Números'), sample: '0-9', chars: '0123456789' },
  { id: 'symbols', label: t('Símbolos'), sample: '- _ . @ # + =', chars: '-_.@#+=' }
]

export const AMBIGUOUS_CHARS = '0Ol1I'
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 64
export const PASSWORD_DEFAULT_LENGTH = 24
export const STRENGTH_SEGMENTS = 10
/** Con 128 bits la barra se llena: más ya no cambia nada en la práctica. */
export const STRENGTH_FULL_BITS = 128

export interface PasswordOptions {
  length: number
  enabled: Record<CharClassId, boolean>
  noAmbiguous: boolean
}

export interface Strength {
  label: string
  color: string
  bits: number
  filledSegments: number
}

const STRENGTH_LEVELS = [
  { belowBits: 60, label: t('Débil'), color: 'var(--err)' },
  { belowBits: 80, label: t('Aceptable'), color: 'var(--warn)' },
  { belowBits: 112, label: t('Fuerte'), color: 'var(--ok)' },
  { belowBits: Infinity, label: t('Muy fuerte'), color: 'var(--accent)' }
]

/** Índice uniforme en [0, max): descarta los valores del tramo final que sesgarían el módulo. */
function randomIndex(max: number): number {
  const range = 2 ** 32
  const unbiasedLimit = range - (range % max)
  const buffer = new Uint32Array(1)
  do {
    crypto.getRandomValues(buffer)
  } while ((buffer[0] as number) >= unbiasedLimit)
  return (buffer[0] as number) % max
}

function pickFrom(chars: string): string {
  return chars[randomIndex(chars.length)] as string
}

/** Caracteres de cada tipo elegido, ya sin los que se confunden si así se pidió. */
export function poolsFor(options: PasswordOptions): string[] {
  const activeClasses = CHAR_CLASSES.filter((charClass) => options.enabled[charClass.id])
  return activeClasses.map((charClass) => {
    if (!options.noAmbiguous) return charClass.chars
    return [...charClass.chars].filter((char) => !AMBIGUOUS_CHARS.includes(char)).join('')
  })
}

/** Al menos un carácter de cada tipo elegido; el resto, de todos juntos; al final se mezcla (Fisher-Yates). */
export function generatePassword(options: PasswordOptions): string {
  const pools = poolsFor(options)
  const allChars = pools.join('')
  const chars = pools.map(pickFrom)
  while (chars.length < options.length) chars.push(pickFrom(allChars))
  for (let index = chars.length - 1; index > 0; index--) {
    const swapWith = randomIndex(index + 1)
    ;[chars[index], chars[swapWith]] = [chars[swapWith] as string, chars[index] as string]
  }
  return chars.join('')
}

/**
 * Fortaleza de una contraseña escrita a mano: la misma cuenta, con los tipos de carácter que trae. Un carácter fuera
 * de los cuatro tipos no agranda el conjunto: la cifra queda por debajo de la real, nunca por encima.
 */
export function strengthOfTyped(password: string): Strength {
  const charsOf = (charClass: CharClass) => [...password].some((char) => charClass.chars.includes(char))
  const enabled = Object.fromEntries(CHAR_CLASSES.map((charClass) => [charClass.id, charsOf(charClass)])) as Record<CharClassId, boolean>
  const hasKnownChars = Object.values(enabled).some(Boolean)
  const weakest = STRENGTH_LEVELS[0]!
  if (!hasKnownChars) return { label: weakest.label, color: weakest.color, bits: 0, filledSegments: 0 }
  return strengthOf({ length: password.length, enabled, noAmbiguous: false })
}

/** Fortaleza por entropía: largo × log2(tamaño del conjunto). */
export function strengthOf(options: PasswordOptions): Strength {
  const poolSize = poolsFor(options).join('').length
  const bits = Math.round(options.length * Math.log2(poolSize))
  const level = STRENGTH_LEVELS.find((candidate) => bits < candidate.belowBits) as (typeof STRENGTH_LEVELS)[number]
  const filledSegments = Math.min(STRENGTH_SEGMENTS, Math.ceil((bits / STRENGTH_FULL_BITS) * STRENGTH_SEGMENTS))
  return { label: level.label, color: level.color, bits, filledSegments }
}
