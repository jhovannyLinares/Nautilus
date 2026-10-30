import { t } from '@shared/i18n'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import { exportExtension, type ExportFormat, type ImportFileInfo } from '@shared/view'
import { VaultError } from '../backend/errors'
import { readHeader } from '../backend/export-file'

/** Un `.nau` de cientos de variables pesa decenas de KB: algo más grande no es un archivo de Nautilus. */
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

/** `Documentos\nautilus_2026-10-29_0840.nau`: con la hora, para no pisar un archivo exportado antes ese día. */
export function defaultExportPath(documentsDir: string, format: ExportFormat, now: Date): string {
  const twoDigits = (part: number) => String(part).padStart(2, '0')
  const date = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`
  const time = `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`
  return join(documentsDir, `nautilus_${date}_${time}${exportExtension(format)}`)
}

/** La ruta llega de la ventana: tiene que ser completa y con la extensión de su formato. */
export function checkExportPath(path: string, format: ExportFormat): void {
  const expected = exportExtension(format)
  if (!isAbsolute(path) || extname(path).toLowerCase() !== expected) {
    throw new VaultError('INVALID', t('El archivo tiene que ser una ruta completa terminada en {0}.', { 0: expected }))
  }
}

export function writeExport(path: string, text: string): void {
  try {
    writeFileSync(path, text, 'utf8')
  } catch (error) {
    throw new VaultError('FILE', t('No se pudo escribir {0} ({1}).', { 0: basename(path), 1: (error as NodeJS.ErrnoException).code ?? 'error de disco' }))
  }
}

export function readImportText(path: string): string {
  try {
    if (statSync(path).size > MAX_IMPORT_BYTES) throw new VaultError('BAD_FILE', t('No es un archivo exportado por Nautilus.'))
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof VaultError) throw error
    throw new VaultError('FILE', t('No se pudo leer {0} ({1}).', { 0: basename(path), 1: (error as NodeJS.ErrnoException).code ?? 'error de disco' }))
  }
}

/** Lo que muestra Importar antes de pedir la contraseña. */
export function inspectImportFile(path: string): ImportFileInfo {
  const header = readHeader(readImportText(path))
  return { path, fileName: basename(path), variables: header.variables, folders: header.folders, encrypted: header.encrypted, exportedAt: header.exportedAt }
}
