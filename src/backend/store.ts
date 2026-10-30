import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { GENERAL_ID } from '@shared/names'

/** `index.json`: carpetas, nombres, fechas y lo publicado. Nunca valores. */
const FolderSchema = z.object({ id: z.string(), name: z.string(), code: z.string(), color: z.string() })
const VarSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  short: z.string(),
  expires: z.string().nullable(),
  updatedAt: z.string(),
  hasValue: z.boolean(),
  // `false` = vive solo en el Administrador de credenciales. Las anteriores a esta opción se publicaban todas: siguen así
  publish: z.boolean().default(true),
  // datos de la cuenta, sin cifrar: un índice anterior a ellos no los trae
  user: z.string().default(''),
  url: z.string().default(''),
  note: z.string().default('')
})
const IndexSchema = z.object({
  version: z.literal(1),
  folders: z.array(FolderSchema),
  vars: z.array(VarSchema),
  published: z.array(z.string()),
  autoLockMin: z.number(),
  // un índice anterior a la integración no lo trae: queda encendida, como en una instalación nueva
  claudeSkill: z.boolean().default(true),
  // un índice anterior a la opción no la trae: queda encendida, como estaba
  pinForValues: z.boolean().default(true)
})

export type Folder = z.infer<typeof FolderSchema>
export type VarMeta = z.infer<typeof VarSchema>
export type IndexData = z.infer<typeof IndexSchema>

export function emptyIndex(): IndexData {
  return {
    version: 1,
    folders: [{ id: GENERAL_ID, name: 'General', code: '', color: '#4d88ff' }],
    vars: [],
    published: [],
    autoLockMin: 10,
    claudeSkill: true,
    pinForValues: true
  }
}

export function loadIndex(file: string): IndexData {
  if (!existsSync(file)) return emptyIndex()
  const data = IndexSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  if (!data.folders.some((f) => f.id === GENERAL_ID)) data.folders.unshift(emptyIndex().folders[0]!)
  return data
}

/** Escritura atómica: archivo temporal y renombrar, para que un corte no deje el índice a medias. */
export function saveIndex(file: string, data: IndexData): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}
