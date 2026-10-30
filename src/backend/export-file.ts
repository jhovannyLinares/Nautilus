import { t } from '@shared/i18n'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { z } from 'zod'
import { fullName, MIN_FILE_PASSWORD_CHARS } from '@shared/names'
import { VaultError } from './errors'

/**
 * Archivos que exporta e importa Nautilus. Puro: arma y lee texto, sin disco ni bóveda.
 * `.nau` cifrado: cabecera a la vista y contenido con AES-256-GCM; la clave sale de la contraseña con scrypt. La
 * cabecera y los parámetros de scrypt van como dato autenticado: cambiar cualquiera invalida el archivo.
 */

const FORMAT = 'nautilus-export'
const VERSION = 1
const CIPHER = 'aes-256-gcm'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
// N=2^15 tarda menos de un segundo y obliga a 32 MB por intento: probar contraseñas a la fuerza sale caro
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 }
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
/** Lo que se puede escribir sin comillas en un `.env`. */
const ENV_SAFE_VALUE = /^[^\s#"'\\]*$/

const NOT_NAUTILUS_TEXT = t('No es un archivo exportado por Nautilus.')
const WRONG_PASSWORD_TEXT = t('La contraseña no abre este archivo, o el archivo fue modificado.')
const PASSWORD_REQUIRED_TEXT = t('Este archivo va cifrado: escribe su contraseña.')

const FolderSchema = z.object({ name: z.string(), code: z.string(), color: z.string() })
const VarSchema = z.object({
  folderCode: z.string(),
  short: z.string(),
  value: z.string().nullable(),
  publish: z.boolean(),
  expires: z.string().nullable(),
  // un .nau anterior a los datos de la cuenta no los trae
  user: z.string().default(''),
  url: z.string().default(''),
  note: z.string().default('')
})
const ContentSchema = z.object({ folders: z.array(FolderSchema), vars: z.array(VarSchema) })
const HeaderSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.string(),
  variables: z.number(),
  folders: z.number(),
  encrypted: z.boolean()
})
// un .nau armado a mano no puede pedir un scrypt que congele la app: los parámetros se acotan antes de derivar
const MAX_SCRYPT_N = 2 ** 17
const MAX_SCRYPT_R = 16
const MAX_SCRYPT_P = 4
const KdfSchema = z.object({
  name: z.literal('scrypt'),
  N: z.number().int().min(2).max(MAX_SCRYPT_N),
  r: z.number().int().min(1).max(MAX_SCRYPT_R),
  p: z.number().int().min(1).max(MAX_SCRYPT_P),
  salt: z.string()
})
const EncryptedFileSchema = HeaderSchema.extend({ kdf: KdfSchema, iv: z.string(), tag: z.string(), data: z.string() })
const NamesFileSchema = HeaderSchema.extend({ content: ContentSchema })

export type ExportedFolder = z.infer<typeof FolderSchema>
// la forma de ENTRADA: usuario, URL y nota pueden faltar (un .nau anterior no los trae; al leer quedan en '')
export type ExportedVar = z.input<typeof VarSchema>
export type ExportContent = z.input<typeof ContentSchema>
export type ExportHeader = z.infer<typeof HeaderSchema>
type Kdf = z.infer<typeof KdfSchema>

/** `password` null = archivo sin valores (los valores del contenido se descartan). */
export function encodeNau(content: ExportContent, options: { password: string | null; now: Date }): string {
  const header: ExportHeader = {
    format: FORMAT,
    version: VERSION,
    exportedAt: options.now.toISOString(),
    variables: content.vars.length,
    folders: content.folders.length,
    encrypted: options.password !== null
  }
  if (options.password === null) {
    const withoutValues = { ...content, vars: content.vars.map((variable) => ({ ...variable, value: null })) }
    return JSON.stringify({ ...header, content: withoutValues }, null, 2)
  }
  if (options.password.length < MIN_FILE_PASSWORD_CHARS) {
    throw new VaultError('INVALID', t('La contraseña del archivo necesita al menos {0} caracteres.', { 0: MIN_FILE_PASSWORD_CHARS }))
  }
  const kdf: Kdf = { name: 'scrypt', ...SCRYPT, salt: randomBytes(SALT_BYTES).toString('base64') }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(CIPHER, deriveKey(options.password, kdf), iv)
  cipher.setAAD(authenticatedData(header, kdf))
  const data = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()])
  const file = { ...header, kdf, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  return JSON.stringify(file, null, 2)
}

/** Lo que se muestra antes de pedir la contraseña. */
export function readHeader(text: string): ExportHeader {
  return parseOrReject(HeaderSchema, text)
}

export function decodeNau(text: string, password: string | null): ExportContent {
  const header = readHeader(text)
  if (!header.encrypted) return parseOrReject(NamesFileSchema, text).content
  if (password === null) throw new VaultError('PASSWORD_REQUIRED', PASSWORD_REQUIRED_TEXT)
  const file = parseOrReject(EncryptedFileSchema, text)
  const fileHeader = HeaderSchema.parse(file)
  try {
    const decipher = createDecipheriv(CIPHER, deriveKey(password, file.kdf), Buffer.from(file.iv, 'base64'))
    decipher.setAAD(authenticatedData(fileHeader, file.kdf))
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8')
    return ContentSchema.parse(JSON.parse(plain))
  } catch {
    // GCM no distingue contraseña equivocada de archivo alterado; el detalle de crypto no le sirve a nadie
    throw new VaultError('BAD_PASSWORD', WRONG_PASSWORD_TEXT)
  }
}

/** `.env` en texto plano: un comentario por carpeta y `NAU_…=valor` debajo. */
export function encodeEnv(content: ExportContent, now: Date): string {
  const blocks = content.folders
    .map((folder) => {
      const lines = content.vars
        .filter((variable) => variable.folderCode === folder.code)
        .map((variable) => `${fullName(folder.code, variable.short)}=${envValue(variable.value ?? '')}`)
        .sort()
      if (lines.length === 0) return null
      const title = folder.code ? `# ${folder.name} (${folder.code})` : `# ${folder.name}`
      return [title, ...lines].join('\n') + '\n'
    })
    .filter((block) => block !== null)
  const intro = `# Nautilus · exportado ${now.toISOString()}\n# Contiene valores en texto plano: bórralo después de usarlo.\n`
  return [intro, ...blocks].join('\n')
}

function envValue(value: string): string {
  if (ENV_SAFE_VALUE.test(value)) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')
  return `"${escaped}"`
}

function deriveKey(password: string, kdf: Kdf): Buffer {
  return scryptSync(password, Buffer.from(kdf.salt, 'base64'), KEY_BYTES, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAX_MEMORY })
}

/** Siempre en el mismo orden de campos: el que cifra y el que descifra tienen que armar los mismos bytes. */
function authenticatedData(header: ExportHeader, kdf: Kdf): Buffer {
  const { format, version, exportedAt, variables, folders, encrypted } = header
  return Buffer.from(JSON.stringify([format, version, exportedAt, variables, folders, encrypted, kdf.name, kdf.N, kdf.r, kdf.p, kdf.salt]), 'utf8')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseOrReject<T>(schema: z.ZodType<T>, text: string): T {
  const parsed = schema.safeParse(parseJson(text))
  if (!parsed.success) throw new VaultError('BAD_FILE', NOT_NAUTILUS_TEXT)
  return parsed.data
}
