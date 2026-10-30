import { t } from '@shared/i18n'
import { daysUntil } from '@shared/names'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** Columna VENCE: «en 12 días», «mañana», «hoy», «ayer», «hace 3 días». */
export function expiresText(expires: string | null, today = new Date()): string {
  if (!expires) return '—'
  const d = daysUntil(expires, today)
  if (d === -1) return t('ayer')
  if (d < 0) return t('hace {0} días', { 0: -d })
  if (d === 0) return t('hoy')
  if (d === 1) return t('mañana')
  return t('en {0} días', { 0: d })
}

/** Fecha `YYYY-MM-DD` como «12/11/2026». */
export function dateText(expires: string | null): string {
  if (!expires) return '—'
  const [y, m, d] = expires.split('-')
  return `${d}/${m}/${y}`
}

/** Columna ACTUALIZADA: «hoy» o «14 sep». */
export function updatedText(iso: string, today = new Date()): string {
  const d = new Date(iso)
  if (d.toDateString() === today.toDateString()) return t('hoy')
  return `${d.getDate()} ${t(MONTHS[d.getMonth()] ?? 'ene')}${d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : ''}`
}

/** «1 variable» o «3 variables». */
export function variablesText(count: number): string {
  return count === 1 ? t('1 variable') : t('{0} variables', { 0: count })
}

/** «1 carpeta» o «3 carpetas». */
export function foldersText(count: number): string {
  return count === 1 ? t('1 carpeta') : t('{0} carpetas', { 0: count })
}
