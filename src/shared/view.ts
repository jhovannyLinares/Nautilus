import type { VarState } from './names'

/** Lo que la ventana recibe de la bóveda. Nunca trae valores. */
export interface FolderView {
  id: string
  name: string
  code: string
  color: string
  count: number
}

export interface VarView {
  id: string
  name: string
  short: string
  folderId: string
  state: VarState
  hasValue: boolean
  /** Se publica también como variable de entorno; si no, vive solo en el Administrador de credenciales. */
  publish: boolean
  expires: string | null
  updatedAt: string
  /** Datos de la cuenta, sin cifrar: se ven sin PIN. */
  user: string
  url: string
  note: string
}

export interface Snapshot {
  folders: FolderView[]
  vars: VarView[]
  published: number
}

export interface VaultStatus {
  hasPin: boolean
  unlocked: boolean
  autoLockMin: number
  /** Minutos que faltan para el bloqueo automático, si está desbloqueada. */
  lockInMin: number | null
  total: number
  /** Mostrar y copiar un valor piden el PIN; apagado, basta con haber desbloqueado. */
  pinForValues: boolean
}

/** Cómo se exporta: `.nau` cifrado con contraseña, `.env` en texto plano o `.nau` solo con los nombres. */
export const EXPORT_FORMATS = ['encrypted', 'plain', 'names'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function exportExtension(format: ExportFormat): '.env' | '.nau' {
  return format === 'plain' ? '.env' : '.nau'
}

/** Lo que muestra Importar antes de pedir la contraseña: viene de la cabecera del archivo. */
export interface ImportFileInfo {
  path: string
  fileName: string
  variables: number
  folders: number
  encrypted: boolean
  exportedAt: string
}

/** Una variable del archivo que cambia algo: nueva, o con otro valor que el que ya existe. Nunca trae el valor. */
export interface ImportRow {
  name: string
  kind: 'new' | 'different'
  /** La carpeta que crea al importarse («Colombia (CO)»), si no existe todavía. */
  createsFolder: string | null
}

export interface ImportPreview {
  rows: ImportRow[]
  sameCount: number
  newFolders: string[]
}

/** Integración con Claude Code: encendida, apagada, o encendida en una PC donde Claude todavía no está instalado. */
export type ClaudeState = 'on' | 'off' | 'noclaude'

/** El estado que recibe la ventana: el de la bóveda más el de la integración con Claude. */
export interface AppStatus extends VaultStatus {
  claude: ClaudeState
  version: string
}
