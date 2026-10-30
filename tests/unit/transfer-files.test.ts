import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkExportPath, defaultExportPath, inspectImportFile } from '../../src/main/transfer-files'
import { encodeNau } from '../../src/backend/export-file'

describe('archivos de importar y exportar', () => {
  it('la ruta por defecto lleva fecha, hora y la extensión del formato', () => {
    const now = new Date(2026, 9, 29, 8, 5)
    expect(defaultExportPath('C:\\Docs', 'encrypted', now)).toBe(join('C:\\Docs', 'nautilus_2026-10-29_0805.nau'))
    expect(defaultExportPath('C:\\Docs', 'plain', now)).toBe(join('C:\\Docs', 'nautilus_2026-10-29_0805.env'))
  })

  it('exportar solo acepta una ruta completa con la extensión de su formato', () => {
    expect(() => checkExportPath('C:\\Docs\\a.nau', 'encrypted')).not.toThrow()
    expect(() => checkExportPath('C:\\Docs\\a.ENV', 'plain')).not.toThrow()
    expect(() => checkExportPath('C:\\Docs\\a.env', 'encrypted')).toThrow(/terminada en .nau/)
    expect(() => checkExportPath('a.nau', 'names')).toThrow(/ruta completa/)
  })

  it('la cabecera de un archivo se lee sin contraseña; uno ajeno se rechaza', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nautilus-transfer-'))
    const nau = join(dir, 'export.nau')
    const content = { folders: [{ name: 'General', code: '', color: '#4d88ff' }], vars: [{ folderCode: '', short: 'X', value: 'v', publish: false, expires: null }] }
    writeFileSync(nau, encodeNau(content, { password: 'contraseña-larga-de-prueba', now: new Date('2026-10-29T08:40:00Z') }))
    expect(inspectImportFile(nau)).toEqual({ path: nau, fileName: 'export.nau', variables: 1, folders: 1, encrypted: true, exportedAt: '2026-10-29T08:40:00.000Z' })

    const other = join(dir, 'otro.nau')
    writeFileSync(other, 'NAU_X=1')
    expect(() => inspectImportFile(other)).toThrow('No es un archivo exportado por Nautilus.')
    expect(() => inspectImportFile(join(dir, 'no-existe.nau'))).toThrow(/No se pudo leer no-existe.nau \(ENOENT\)/)
  })
})
