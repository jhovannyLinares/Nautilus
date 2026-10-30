import { t } from './i18n'
/** Reglas de nombres, códigos y estados. Sin dependencias: lo usan la bóveda, los tests y el renderer. */

export const PREFIX = 'NAU_'
export const GENERAL_ID = 'general'
/** Límite de Windows para el valor de una credencial genérica (CRED_MAX_CREDENTIAL_BLOB_SIZE). */
export const MAX_VALUE_BYTES = 2560
/** El valor se guarda en UTF-16: 2 bytes por carácter. */
export const MAX_VALUE_CHARS = MAX_VALUE_BYTES / 2
export const SOON_DAYS = 15
export const PIN_DIGITS = 6
export const PIN_PATTERN = new RegExp(`^\\d{${PIN_DIGITS}}$`)
export const PIN_RULE_TEXT = t('El PIN es de {0} dígitos.', { 0: PIN_DIGITS })
export const VALUE_TOO_LONG_TEXT = t('El valor supera el límite de Windows ({0} caracteres).', { 0: MAX_VALUE_CHARS.toLocaleString('es') })
export const AUTO_LOCK_OPTIONS = [5, 10, 30, 60] as const
/** La contraseña de un archivo exportado: es lo único que protege los valores fuera del equipo. */
export const MIN_FILE_PASSWORD_CHARS = 12
// los 6 primeros conservan su posición: FolderDialog usa uno por índice como color de una carpeta nueva
export const FOLDER_COLORS = [
  '#4d88ff', '#15a0bf', '#7bd938', '#c517b6', '#f2ca33', '#e8743b',
  '#2fc6a0', '#b5835a', '#ff5c8a', '#a974ff', '#9aa3b2'
] as const
/** Usuario, URL y nota de una variable: van sin cifrar en el índice, así que se acotan como texto de referencia. */
export const MAX_USER_CHARS = 200
export const MAX_URL_CHARS = 500
export const MAX_NOTE_CHARS = 500

export type VarState = 'Activa' | 'Nueva' | 'Vacía' | 'Vence pronto' | 'Vencida'

/** Lo que el usuario escribe como nombre: mayúsculas, espacios y guiones a `_`, el resto fuera. */
export function normalizeShort(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '_').replace(/[^A-Z0-9_]/g, '')
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
}

export function isValidShort(short: string): boolean {
  return /^[A-Z0-9][A-Z0-9_]{0,59}$/.test(short)
}

export function isValidCode(code: string): boolean {
  return /^[A-Z]{2,4}$/.test(code)
}

export function fullName(code: string, short: string): string {
  return PREFIX + (code ? code + '_' : '') + short
}

export function valueTooLong(value: string): boolean {
  // los strings de JS son UTF-16, igual que la credencial: el largo del string es el de la credencial
  return value.length > MAX_VALUE_CHARS
}

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin)
}

/** Validación de «PIN nuevo + repetirlo». Devuelve el error para mostrar, o null si está bien. */
export function newPinError(pin: string, repeated: string): string | null {
  if (!isValidPin(pin)) return PIN_RULE_TEXT
  if (pin !== repeated) return t('Los dos PIN no coinciden.')
  return null
}

/** Días de hoy a la fecha `YYYY-MM-DD`, en calendario local (negativo si ya pasó). */
export function daysUntil(expires: string, today: Date): number {
  const [y, m, d] = expires.split('-').map(Number)
  const target = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target.getTime() - base.getTime()) / 86_400_000)
}

export function varState(v: { hasValue: boolean; expires: string | null; fresh: boolean }, today: Date): VarState {
  if (!v.hasValue) return 'Vacía'
  if (v.expires && daysUntil(v.expires, today) < 0) return 'Vencida'
  if (v.expires && daysUntil(v.expires, today) <= SOON_DAYS) return 'Vence pronto'
  return v.fresh ? 'Nueva' : 'Activa'
}
