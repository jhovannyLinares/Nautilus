import { describe, expect, it } from 'vitest'
import { decodeNau, encodeEnv, encodeNau, readHeader, type ExportContent } from '../../src/backend/export-file'

const PASSWORD = 'contraseña-larga-de-prueba'
const NOW = new Date('2026-10-29T08:40:00Z')
const WRONG_FILE_TEXT = 'La contraseña no abre este archivo, o el archivo fue modificado.'

const CONTENT: ExportContent = {
  folders: [
    { name: 'General', code: '', color: '#4d88ff' },
    { name: 'Uruguay', code: 'UY', color: '#7bd938' }
  ],
  vars: [
    { folderCode: '', short: 'AZDO_PAT', value: 'token-123', publish: true, expires: '2026-12-01', user: 'jlinares', url: 'https://dev.azure.com/org', note: 'Rota cada 90 días' },
    { folderCode: 'UY', short: 'DEV_INSIS_AMX', value: 'clave con espacios', publish: false, expires: null, user: '', url: '', note: '' },
    { folderCode: 'UY', short: 'VACIA', value: null, publish: false, expires: null, user: '', url: '', note: '' }
  ]
}

/** Cambia un carácter del campo base64 sin romper el JSON. */
function tamper(text: string, field: 'data' | 'tag'): string {
  const file = JSON.parse(text)
  const original: string = file[field]
  file[field] = (original[0] === 'A' ? 'B' : 'A') + original.slice(1)
  return JSON.stringify(file)
}

describe('.nau cifrado', () => {
  it('ida y vuelta devuelve lo mismo, y los valores no se leen en el archivo', () => {
    const text = encodeNau(CONTENT, { password: PASSWORD, now: NOW })
    expect(text).not.toContain('token-123')
    expect(text).not.toContain('DEV_INSIS_AMX')
    expect(decodeNau(text, PASSWORD)).toEqual(CONTENT)
  })

  it('la cabecera se lee sin contraseña', () => {
    const header = readHeader(encodeNau(CONTENT, { password: PASSWORD, now: NOW }))
    expect(header).toEqual({ format: 'nautilus-export', version: 1, exportedAt: NOW.toISOString(), variables: 3, folders: 2, encrypted: true })
  })

  it('contraseña incorrecta, datos alterados y cabecera alterada dan el mismo error', () => {
    const text = encodeNau(CONTENT, { password: PASSWORD, now: NOW })
    expect(() => decodeNau(text, 'otra-contraseña-larga')).toThrow(WRONG_FILE_TEXT)
    expect(() => decodeNau(tamper(text, 'data'), PASSWORD)).toThrow(WRONG_FILE_TEXT)
    expect(() => decodeNau(tamper(text, 'tag'), PASSWORD)).toThrow(WRONG_FILE_TEXT)
    const header = JSON.parse(text)
    header.variables = 99
    expect(() => decodeNau(JSON.stringify(header), PASSWORD)).toThrow(WRONG_FILE_TEXT)
  })

  it('sin contraseña pide una; con una corta no exporta', () => {
    const text = encodeNau(CONTENT, { password: PASSWORD, now: NOW })
    expect(() => decodeNau(text, null)).toThrow('Este archivo va cifrado: escribe su contraseña.')
    expect(() => encodeNau(CONTENT, { password: 'corta', now: NOW })).toThrow(/al menos 12/)
  })

  it('un archivo que no es de Nautilus se rechaza', () => {
    expect(() => readHeader('NAU_X=1')).toThrow('No es un archivo exportado por Nautilus.')
    expect(() => readHeader('{"format":"otro"}')).toThrow('No es un archivo exportado por Nautilus.')
  })
})

describe('.nau sin valores', () => {
  it('no trae ningún valor y se lee sin contraseña', () => {
    const text = encodeNau(CONTENT, { password: null, now: NOW })
    expect(text).not.toContain('token-123')
    expect(text).not.toContain('clave con espacios')
    expect(readHeader(text).encrypted).toBe(false)
    const decoded = decodeNau(text, null)
    expect(decoded.vars.map((variable) => variable.value)).toEqual([null, null, null])
    expect(decoded.vars[0]).toMatchObject({ short: 'AZDO_PAT', publish: true, expires: '2026-12-01' })
  })
})

describe('.env en texto plano', () => {
  it('agrupa por carpeta y pone comillas solo donde hacen falta', () => {
    const tricky: ExportContent = {
      folders: [{ name: 'General', code: '', color: '#4d88ff' }],
      vars: [
        { folderCode: '', short: 'SIMPLE', value: 'abc-123_.@+=', publish: false, expires: null },
        { folderCode: '', short: 'ESPACIO', value: 'a b', publish: false, expires: null },
        { folderCode: '', short: 'NUMERAL', value: 'a#b', publish: false, expires: null },
        { folderCode: '', short: 'COMILLAS', value: 'di "hola" y \'chau\'', publish: false, expires: null },
        { folderCode: '', short: 'BARRA', value: 'C:\\ruta', publish: false, expires: null },
        { folderCode: '', short: 'LINEAS', value: 'uno\ndos', publish: false, expires: null }
      ]
    }
    const lines = encodeEnv(tricky, NOW).split('\n')
    expect(lines).toContain('NAU_SIMPLE=abc-123_.@+=')
    expect(lines).toContain('NAU_ESPACIO="a b"')
    expect(lines).toContain('NAU_NUMERAL="a#b"')
    expect(lines).toContain('NAU_COMILLAS="di \\"hola\\" y \'chau\'"')
    expect(lines).toContain('NAU_BARRA="C:\\\\ruta"')
    expect(lines).toContain('NAU_LINEAS="uno\\ndos"')
  })

  it('cada carpeta lleva su comentario y una vacía sale sin valor', () => {
    const text = encodeEnv(CONTENT, NOW)
    expect(text).toContain('# General\nNAU_AZDO_PAT=token-123\n')
    expect(text).toContain('# Uruguay (UY)\nNAU_UY_DEV_INSIS_AMX="clave con espacios"\nNAU_UY_VACIA=\n')
  })
})

describe('.nau armado a mano', () => {
  it('un scrypt con parámetros fuera de rango se rechaza antes de derivar la clave', () => {
    const file = JSON.parse(encodeNau(CONTENT, { password: PASSWORD, now: NOW }))
    file.kdf.p = 1_000_000
    expect(() => decodeNau(JSON.stringify(file), PASSWORD)).toThrow('No es un archivo exportado por Nautilus.')
  })

  it('un .nau anterior a los datos de la cuenta se lee con usuario, URL y nota vacíos', () => {
    const file = JSON.parse(encodeNau(CONTENT, { password: null, now: NOW }))
    for (const variable of file.content.vars) {
      delete variable.user
      delete variable.url
      delete variable.note
    }
    const decoded = decodeNau(JSON.stringify(file), null)
    expect(decoded.vars.map(({ user, url, note }) => ({ user, url, note }))).toEqual(CONTENT.vars.map(() => ({ user: '', url: '', note: '' })))
  })
})
