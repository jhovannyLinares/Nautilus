import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  AUTO_LOCK_OPTIONS,
  fullName,
  GENERAL_ID,
  isValidCode,
  isValidShort,
  MAX_NOTE_CHARS,
  MAX_URL_CHARS,
  MAX_USER_CHARS,
  VALUE_TOO_LONG_TEXT,
  valueTooLong,
  varState
} from '@shared/names'
import type { ExportFormat, ImportPreview, ImportRow, Snapshot, VaultStatus } from '@shared/view'
import type { EnvPublisher } from './environment'
import { VaultError } from './errors'
import { decodeNau, encodeEnv, encodeNau, type ExportContent, type ExportedVar } from './export-file'
import { OpLog } from './op-log'
import { PinGuard } from './pin-guard'
import { Publication } from './publication'
import type { SecretStore } from './secrets'
import { loadIndex, saveIndex, type Folder, type IndexData, type VarMeta } from './store'

const MINUTE_MS = 60_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PIN_REQUIRED_TEXT = t('Escribe tu PIN para continuar.')

export interface VaultOptions {
  dir: string
  secrets: SecretStore
  env: EnvPublisher
  /** El registro de la app; si no se pasa, la bóveda escribe en `{dir}/logs/nautilus.log`. */
  log?: OpLog
  now?: () => Date
}

export interface VarInput {
  folderId: string
  short: string
  /** `null` al editar = conservar el valor actual. */
  value: string | null
  expires: string | null
  /** Publicarla también como variable de entorno mientras Nautilus está desbloqueada. */
  publish: boolean
  /** Datos de la cuenta. Ausente al editar = conservar el actual (mover de carpeta no los manda). */
  user?: string
  url?: string
  note?: string
}

export interface FolderInput {
  name: string
  code: string
  color: string
}

export interface ExportRequest {
  folderIds: string[]
  format: ExportFormat
  /** Solo para `encrypted`. */
  password: string | null
}

/** Avance de una operación larga: hechas y total. */
export type Progress = (done: number, total: number) => void

export interface ImportResult {
  created: number
  replaced: number
  /** Nautilus se bloqueó en medio: lo hecho queda, el resto no se importó. */
  interrupted: boolean
}

function ignoreProgress(): void {}

function badFile(detail: string): VaultError {
  return new VaultError('BAD_FILE', t('El archivo trae un dato no válido ({0}): no se importó nada.', { 0: detail }))
}

/** Un cambio de nombre pendiente: la variable y sus nombres completos antes y después. */
interface Rename {
  variable: VarMeta
  from: string
  to: string
}

/**
 * La bóveda: variables y carpetas sobre el índice, el Administrador de credenciales y el entorno.
 * Regla fija: ningún valor sale de aquí hacia el índice, el log ni un mensaje de error.
 */
export class Vault {
  private readonly data: IndexData
  private readonly indexFile: string
  private readonly secrets: SecretStore
  private readonly pin: PinGuard
  private readonly publication: Publication
  private readonly log: OpLog
  private readonly now: () => Date
  private unlocked = false
  private lastActivityMs: number

  constructor(options: VaultOptions) {
    this.now = options.now ?? (() => new Date())
    this.indexFile = join(options.dir, 'index.json')
    this.data = loadIndex(this.indexFile)
    this.secrets = options.secrets
    this.pin = new PinGuard(options.secrets, this.now)
    this.publication = new Publication(options.env, this.data.published)
    this.log = options.log ?? new OpLog(join(options.dir, 'logs', 'nautilus.log'), this.now)
    this.lastActivityMs = this.now().getTime()
  }

  // ---------- estado ----------

  status(): VaultStatus {
    return {
      hasPin: this.pin.hasPin(),
      unlocked: this.unlocked,
      autoLockMin: this.data.autoLockMin,
      lockInMin: this.unlocked ? Math.max(0, Math.ceil(this.idleMsLeft() / MINUTE_MS)) : null,
      total: this.data.vars.length,
      pinForValues: this.data.pinForValues
    }
  }

  isUnlocked(): boolean {
    return this.unlocked
  }

  touch(): void {
    this.lastActivityMs = this.now().getTime()
  }

  idleExpired(): boolean {
    return this.unlocked && this.idleMsLeft() <= 0
  }

  snapshot(): Snapshot {
    this.requireUnlocked()
    const today = this.now()
    const vars = this.data.vars.map((variable) => {
      const name = this.nameOf(variable)
      const fresh = this.publication.isFresh(name)
      return {
        id: variable.id,
        name,
        short: variable.short,
        folderId: variable.folderId,
        state: varState({ hasValue: variable.hasValue, expires: variable.expires, fresh }, today),
        hasValue: variable.hasValue,
        publish: variable.publish,
        expires: variable.expires,
        updatedAt: variable.updatedAt,
        user: variable.user,
        url: variable.url,
        note: variable.note
      }
    })
    return {
      folders: this.data.folders.map((folder) => ({ ...folder, count: this.varsIn(folder.id).length })),
      vars: vars.sort((a, b) => a.name.localeCompare(b.name)),
      published: this.publication.count
    }
  }

  // ---------- PIN y bloqueo ----------

  createPin(pin: string): void {
    this.pin.create(pin)
    this.log.op('pin-create', 'PIN creado')
  }

  /** «Olvidé mi PIN»: los valores se conservan, solo cambia el PIN. Deja la bóveda desbloqueada. */
  resetPin(pin: string): void {
    this.pin.replace(pin)
    this.log.op('pin-reset', 'PIN reemplazado con «Olvidé mi PIN»')
    this.openSession()
  }

  unlock(pin: string): void {
    this.pin.verify(pin)
    this.openSession()
  }

  /** Retira todo lo publicado. Lo llaman Bloquear, el bloqueo automático, Windows+L y el cierre. */
  lock(): void {
    // primero se cierra la sesión: si retirar una variable falla, la bóveda ya no entrega valores, y lo que quedó
    // sigue en `published` para que cleanupOnStart lo retire en el próximo arranque
    this.unlocked = false
    try {
      this.publication.retireAll()
    } finally {
      this.commit('lock', `bloqueada; ${this.publication.count} variables sin retirar del entorno`)
    }
  }

  /** Al arrancar: retira lo que quedó publicado por un cierre anormal. */
  cleanupOnStart(): number {
    const leftovers = this.publication.count
    if (leftovers === 0) return 0
    this.publication.retireAll()
    this.commit('startup-cleanup', `${leftovers} variables retiradas tras un cierre anormal`)
    return leftovers
  }

  setAutoLock(minutes: number): void {
    if (!(AUTO_LOCK_OPTIONS as readonly number[]).includes(minutes)) throw new VaultError('INVALID', t('Tiempo no válido.'))
    this.data.autoLockMin = minutes
    this.save()
  }

  claudeSkillEnabled(): boolean {
    return this.data.claudeSkill
  }

  setClaudeSkill(enabled: boolean): void {
    this.data.claudeSkill = enabled
    this.save()
  }

  /** Apagarla pide el PIN: si no, quien esté frente a la ventana desbloqueada podría quitar la protección. */
  setPinForValues(enabled: boolean, pin: string | null): void {
    if (!enabled) this.verifyPin(pin)
    this.data.pinForValues = enabled
    this.commit('pin-for-values', enabled ? 'mostrar y copiar piden el PIN' : 'mostrar y copiar sin PIN')
  }

  // ---------- variables ----------

  createVar(input: VarInput): string {
    this.requireUnlocked()
    const variable = this.insertVar(input)
    this.commit('var-create', this.nameOf(variable))
    return variable.id
  }

  updateVar(id: string, input: VarInput): void {
    this.requireUnlocked()
    const variable = this.varById(id)
    const oldName = this.nameOf(variable)
    const newName = this.checkedName(this.folderById(input.folderId), input.short, variable.id)
    if (input.value !== null) this.checkValue(input.value)
    this.checkExpires(input.expires)
    const account = this.checkedAccount(input, variable)

    const value = input.value ?? this.currentValue(variable)
    if (newName !== oldName || input.value !== null) this.replaceSecret(oldName, newName, value)
    this.syncPublication(newName, value, input.publish)

    variable.folderId = input.folderId
    variable.short = input.short
    variable.expires = input.expires
    variable.hasValue = value !== ''
    variable.publish = input.publish
    Object.assign(variable, account)
    variable.updatedAt = this.now().toISOString()
    this.commit('var-update', newName !== oldName ? `${oldName} -> ${newName}` : newName)
  }

  deleteVar(id: string): void {
    this.requireUnlocked()
    const variable = this.varById(id)
    const name = this.nameOf(variable)
    this.dropSecret(name)
    this.data.vars = this.data.vars.filter((other) => other.id !== id)
    this.commit('var-delete', name)
  }

  /** Devuelve el valor, tras confirmar el PIN si la configuración lo pide. Es la única salida de un valor hacia afuera de la bóveda. */
  reveal(id: string, pin: string | null): string {
    this.requireUnlocked()
    if (this.data.pinForValues) this.verifyPin(pin)
    return this.currentValue(this.varById(id))
  }

  private verifyPin(pin: string | null): void {
    if (pin === null) throw new VaultError('PIN_REQUIRED', PIN_REQUIRED_TEXT)
    this.pin.verify(pin)
  }

  // ---------- carpetas ----------

  createFolder(input: FolderInput): string {
    this.requireUnlocked()
    this.checkFolder(input, null)
    const folder: Folder = { id: randomUUID(), name: input.name.trim(), code: input.code, color: input.color }
    this.data.folders.push(folder)
    this.commit('folder-create', `${folder.name} (${folder.code})`)
    return folder.id
  }

  /** Editar nombre, color o código. Cambiar el código renombra todas sus variables. */
  updateFolder(id: string, input: FolderInput): void {
    this.requireUnlocked()
    const folder = this.folderById(id)
    const isGeneral = folder.id === GENERAL_ID
    if (isGeneral && input.code !== '') throw new VaultError('GENERAL', t('General no lleva código.'))
    if (!isGeneral) this.checkFolder(input, id)

    if (input.code !== folder.code) this.applyRenames(this.renamesFor(this.varsIn(id), input.code))
    folder.name = isGeneral ? folder.name : input.name.trim()
    folder.code = input.code
    folder.color = input.color
    this.commit('folder-update', `${folder.name} (${folder.code || 'sin código'})`)
  }

  /** Una carpeta con variables solo se borra moviéndolas a General o eliminándolas. */
  deleteFolder(id: string, mode: 'move' | 'drop'): void {
    this.requireUnlocked()
    if (id === GENERAL_ID) throw new VaultError('GENERAL', t('General no se puede borrar.'))
    const folder = this.folderById(id)
    const inside = this.varsIn(id)

    if (mode === 'move') {
      this.applyRenames(this.renamesFor(inside, ''))
      for (const variable of inside) variable.folderId = GENERAL_ID
    } else {
      for (const variable of inside) this.dropSecret(this.nameOf(variable))
      this.data.vars = this.data.vars.filter((variable) => variable.folderId !== id)
    }
    this.data.folders = this.data.folders.filter((other) => other.id !== id)
    const outcome = mode === 'move' ? 'movidas a General' : 'eliminadas'
    this.commit('folder-delete', `${folder.name} (${folder.code}); variables ${outcome}: ${inside.length}`)
  }

  // ---------- exportar, importar y vaciar ----------

  /** El texto del archivo exportado. Con valores (cifrado o `.env`) es la otra salida de valores: pide el PIN. */
  async exportText(request: ExportRequest, pin: string, onProgress: Progress = ignoreProgress): Promise<{ text: string; count: number }> {
    this.requireUnlocked()
    this.pin.verify(pin)
    const folders = request.folderIds.map((id) => this.folderById(id))
    if (folders.length === 0) throw new VaultError('INVALID', t('Elige al menos una carpeta.'))
    const withValues = request.format !== 'names'
    const selected = folders.flatMap((folder) => this.varsIn(folder.id).map((variable) => ({ folder, variable })))
    const vars: ExportedVar[] = []
    for (const { folder, variable } of selected) {
      const value = withValues && variable.hasValue ? await this.currentValueAsync(variable) : null
      // si se bloqueó mientras leía, no se arma ningún archivo
      this.requireUnlocked()
      vars.push({
        folderCode: folder.code,
        short: variable.short,
        value,
        publish: variable.publish,
        expires: variable.expires,
        user: variable.user,
        url: variable.url,
        note: variable.note
      })
      this.reportProgress(onProgress, vars.length, selected.length)
    }
    const content: ExportContent = { folders: folders.map(({ name, code, color }) => ({ name, code, color })), vars }
    const text =
      request.format === 'plain'
        ? encodeEnv(content, this.now())
        : encodeNau(content, { password: request.format === 'encrypted' ? (request.password ?? '') : null, now: this.now() })
    this.log.op('export', `${content.vars.length} variables de ${folders.length} carpetas, formato ${request.format}`)
    return { text, count: content.vars.length }
  }

  /** Qué haría importar el archivo, sin cambiar nada. */
  async importPreview(text: string, password: string | null): Promise<ImportPreview> {
    this.requireUnlocked()
    const plan = await this.planImport(decodeNau(text, password))
    return {
      rows: plan.items
        .filter((item) => item.kind !== 'same')
        .map((item) => ({ name: item.name, kind: item.kind as ImportRow['kind'], createsFolder: plan.newFolderCodes.has(item.source.folderCode) ? plan.folderLabel(item.source.folderCode) : null })),
      sameCount: plan.items.filter((item) => item.kind === 'same').length,
      newFolders: [...plan.newFolderCodes].map((code) => plan.folderLabel(code))
    }
  }

  /**
   * Crea las nuevas (y sus carpetas) y reemplaza las de otro valor que vienen en `replace`; las demás no se tocan.
   * Todo se valida antes de escribir: un archivo con un nombre inválido no deja nada a medias. Cada variable se
   * guarda en el índice al escribirse; si Nautilus se bloquea en medio, se corta ahí y lo hecho queda en el índice.
   */
  async importApply(text: string, password: string | null, replace: string[], pin: string, onProgress: Progress = ignoreProgress): Promise<ImportResult> {
    this.requireUnlocked()
    this.pin.verify(pin)
    const plan = await this.planImport(decodeNau(text, password))
    const replaceSet = new Set(replace)
    const work = plan.items.filter((item) => item.kind === 'new' || (item.kind === 'different' && replaceSet.has(item.name)))

    for (const code of plan.newFolderCodes) {
      const folder = plan.fileFolders.get(code)!
      this.data.folders.push({ id: randomUUID(), name: folder.name.trim(), code, color: folder.color })
    }
    let created = 0
    let replaced = 0
    for (const item of work) {
      if (!this.unlocked) break
      if (item.kind === 'new') {
        const folder = this.data.folders.find((candidate) => candidate.code === item.source.folderCode)!
        const { short, value, expires, publish, user, url, note } = item.source
        await this.insertVarAsync({ folderId: folder.id, short, value, expires, publish, user, url, note })
        created++
      } else {
        await this.overwriteValueAsync(item.existing!, item.source.value ?? '')
        replaced++
      }
      this.save()
      this.reportProgress(onProgress, created + replaced, work.length)
    }
    const interrupted = created + replaced < work.length
    const skipped = plan.items.length - created - replaced
    const outcome = `${created} creadas, ${replaced} reemplazadas, ${skipped} sin tocar; carpetas nuevas: ${plan.newFolderCodes.size}`
    this.commit('import', interrupted ? `cortada al bloquearse: ${outcome}` : outcome)
    return { created, replaced, interrupted }
  }

  /**
   * Borra todas las variables y carpetas de Nautilus. Conserva el PIN, los ajustes y General. Cada borrado se guarda
   * en el índice; si Nautilus se bloquea en medio, se corta ahí y las que quedan siguen intactas.
   */
  async wipe(pin: string, onProgress: Progress = ignoreProgress): Promise<{ deleted: number; interrupted: boolean }> {
    this.requireUnlocked()
    this.pin.verify(pin)
    const all = [...this.data.vars]
    const folderCount = this.data.folders.length - 1
    let deleted = 0
    for (const variable of all) {
      if (!this.unlocked) break
      const name = this.nameOf(variable)
      await this.secrets.deleteAsync(name)
      this.publication.retire(name)
      this.data.vars = this.data.vars.filter((other) => other.id !== variable.id)
      this.save()
      deleted++
      this.reportProgress(onProgress, deleted, all.length)
    }
    this.data.folders = this.data.folders.filter((folder) => folder.id === GENERAL_ID || this.varsIn(folder.id).length > 0)
    const interrupted = deleted < all.length
    const outcome = `${deleted} variables y ${folderCount - (this.data.folders.length - 1)} carpetas borradas`
    this.commit('wipe', interrupted ? `cortado al bloquearse: ${outcome}` : outcome)
    return { deleted, interrupted }
  }

  /** Avisa el avance y cuenta como uso: una operación larga no debe disparar el bloqueo automático. */
  private reportProgress(onProgress: Progress, done: number, total: number): void {
    this.touch()
    onProgress(done, total)
  }

  /** Compara el archivo con la bóveda. Valida cada nombre y valor antes de que se escriba nada. */
  private async planImport(content: ExportContent) {
    const fileFolders = new Map(content.folders.map((folder) => [folder.code, folder]))
    const newFolderCodes = new Set<string>()
    const seen = new Set<string>()
    const items = []
    for (const source of content.vars) {
      const fileFolder = fileFolders.get(source.folderCode)
      if (source.folderCode !== '' && !isValidCode(source.folderCode)) throw badFile(t('código de carpeta {0}', { 0: source.folderCode }))
      if (!isValidShort(source.short)) throw badFile(`nombre ${source.short}`)
      const name = fullName(source.folderCode, source.short)
      if (seen.has(name)) throw badFile(`${name} repetida`)
      seen.add(name)
      this.checkValue(source.value ?? '')
      this.checkExpires(source.expires)
      this.checkedAccount(source, null)

      const folderExists = this.data.folders.some((folder) => folder.code === source.folderCode)
      if (!folderExists) {
        if (!fileFolder?.name.trim()) throw badFile(t('carpeta {0} sin nombre', { 0: source.folderCode }))
        newFolderCodes.add(source.folderCode)
      }
      const existing = this.data.vars.find((variable) => this.nameOf(variable) === name) ?? null
      items.push({ source, name, existing, kind: await this.importKind(existing, source.value) })
      // leer los valores actuales lleva tiempo: si se bloqueó en medio, no hay vista previa
      this.requireUnlocked()
    }
    const folderLabel = (code: string) => `${fileFolders.get(code)?.name.trim() ?? code} (${code})`
    return { items, newFolderCodes, fileFolders, folderLabel }
  }

  /** Un archivo sin valores nunca pisa: lo que ya existe cuenta como igual. */
  private async importKind(existing: VarMeta | null, value: string | null): Promise<'new' | 'same' | 'different'> {
    if (!existing) return 'new'
    if (value === null) return 'same'
    return (await this.currentValueAsync(existing)) === value ? 'same' : 'different'
  }

  /** Cambia el valor de una variable que ya existe, sin tocar su nombre ni dónde vive. */
  private async overwriteValueAsync(variable: VarMeta, value: string): Promise<void> {
    const name = this.nameOf(variable)
    if (value === '') await this.secrets.deleteAsync(name)
    else await this.secrets.setAsync(name, value)
    variable.hasValue = value !== ''
    variable.updatedAt = this.now().toISOString()
    this.publication.retire(name)
    if (this.unlocked) this.syncPublication(name, value, variable.publish)
  }

  /** Valida, guarda el valor y publica si corresponde; no cierra la operación (lo hace quien llama). */
  private insertVar(input: VarInput): VarMeta {
    const { variable, name, value } = this.newVar(input)
    if (variable.hasValue) this.secrets.set(name, value)
    this.attachVar(variable, name, value)
    return variable
  }

  private async insertVarAsync(input: VarInput): Promise<void> {
    const { variable, name, value } = this.newVar(input)
    if (variable.hasValue) await this.secrets.setAsync(name, value)
    this.attachVar(variable, name, value)
  }

  /** La variable validada, todavía fuera del índice y sin valor guardado. */
  private newVar(input: VarInput): { variable: VarMeta; name: string; value: string } {
    const folder = this.folderById(input.folderId)
    const name = this.checkedName(folder, input.short, null)
    const value = input.value ?? ''
    this.checkValue(value)
    this.checkExpires(input.expires)
    const account = this.checkedAccount(input, null)
    const variable: VarMeta = {
      id: randomUUID(),
      folderId: folder.id,
      short: input.short,
      expires: input.expires,
      updatedAt: this.now().toISOString(),
      hasValue: value !== '',
      publish: input.publish,
      ...account
    }
    return { variable, name, value }
  }

  /** La suma al índice y la publica si corresponde; bloqueada no se publica nada (lo hará el desbloqueo). */
  private attachVar(variable: VarMeta, name: string, value: string): void {
    this.data.vars.push(variable)
    if (this.unlocked) this.syncPublication(name, value, variable.publish)
  }

  private async currentValueAsync(variable: VarMeta): Promise<string> {
    return variable.hasValue ? ((await this.secrets.getAsync(this.nameOf(variable))) ?? '') : ''
  }

  // ---------- sesión y publicación ----------

  private openSession(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.touch()
    for (const variable of this.data.vars) {
      if (!variable.hasValue || !variable.publish) continue
      const name = this.nameOf(variable)
      const value = this.secrets.get(name)
      if (value) this.publication.publish(name, value, { fresh: false })
    }
    this.commit('unlock', `${this.publication.count} variables publicadas`)
  }

  private idleMsLeft(): number {
    return this.data.autoLockMin * MINUTE_MS - (this.now().getTime() - this.lastActivityMs)
  }

  /**
   * Guarda el valor bajo el nombre nuevo y retira el viejo del entorno; `syncPublication` publica después el nuevo.
   * Escribe antes de borrar: si Windows falla, no se pierde.
   */
  private replaceSecret(oldName: string, newName: string, value: string): void {
    if (value !== '') this.secrets.set(newName, value)
    // el nombre viejo sobra si cambió de nombre, o si se vació el valor (mismo nombre)
    if (oldName !== newName || value === '') this.secrets.delete(oldName)
    this.publication.retire(oldName)
  }

  /** Deja el entorno como pide «Publicar también como variable de entorno»: publicada con su valor, o retirada. */
  private syncPublication(name: string, value: string, publish: boolean): void {
    if (!publish || value === '') this.publication.retire(name)
    else if (!this.publication.isPublished(name)) this.publication.publish(name, value, { fresh: true })
  }

  private dropSecret(name: string): void {
    this.secrets.delete(name)
    this.publication.retire(name)
  }

  private currentValue(variable: VarMeta): string {
    return variable.hasValue ? (this.secrets.get(this.nameOf(variable)) ?? '') : ''
  }

  private renamesFor(variables: VarMeta[], newCode: string): Rename[] {
    const renames = variables.map((variable) => ({ variable, from: this.nameOf(variable), to: fullName(newCode, variable.short) }))
    this.ensureFree(renames)
    return renames
  }

  private applyRenames(renames: Rename[]): void {
    for (const { variable, from, to } of renames) {
      if (from === to) continue
      const value = this.currentValue(variable)
      const wasPublished = this.publication.isPublished(from)
      if (value !== '') this.secrets.set(to, value)
      this.secrets.delete(from)
      this.publication.retire(from)
      if (wasPublished && value !== '') this.publication.publish(to, value, { fresh: true })
      variable.updatedAt = this.now().toISOString()
      this.log.op('var-rename', `${from} -> ${to}`)
    }
  }

  /** Ningún nombre nuevo puede chocar con otra variable ni con otro nombre nuevo; si choca, no se cambia nada. */
  private ensureFree(renames: Rename[]): void {
    const movingIds = new Set(renames.map((rename) => rename.variable.id))
    const taken = new Set(this.data.vars.filter((variable) => !movingIds.has(variable.id)).map((variable) => this.nameOf(variable)))
    const targets = renames.map((rename) => rename.to)
    const clash = targets.find((name, index) => taken.has(name) || targets.indexOf(name) !== index)
    if (clash) throw new VaultError('NAME_TAKEN', t('Ya existe {0}: no se cambió nada.', { 0: clash }))
  }

  // ---------- validaciones ----------

  private checkedName(folder: Folder, short: string, selfId: string | null): string {
    if (!isValidShort(short)) throw new VaultError('INVALID_NAME', t('El nombre solo admite A-Z, 0-9 y _, y no puede empezar con _.'))
    const name = fullName(folder.code, short)
    const taken = this.data.vars.some((variable) => variable.id !== selfId && this.nameOf(variable) === name)
    if (taken) throw new VaultError('NAME_TAKEN', t('Ya existe {0}', { 0: name }))
    return name
  }

  private checkValue(value: string): void {
    if (valueTooLong(value)) throw new VaultError('VALUE_TOO_LONG', VALUE_TOO_LONG_TEXT)
  }

  /** Usuario, URL y nota ya recortados y validados; lo que no viene se toma de `current` (o vacío si es nueva). */
  private checkedAccount(input: Pick<VarInput, 'user' | 'url' | 'note'>, current: VarMeta | null): Pick<VarMeta, 'user' | 'url' | 'note'> {
    const account = {
      user: (input.user ?? current?.user ?? '').trim(),
      url: (input.url ?? current?.url ?? '').trim(),
      note: (input.note ?? current?.note ?? '').trim()
    }
    if (account.user.length > MAX_USER_CHARS) throw new VaultError('INVALID', t('El usuario supera {0} caracteres.', { 0: MAX_USER_CHARS }))
    if (account.url.length > MAX_URL_CHARS) throw new VaultError('INVALID', t('La URL supera {0} caracteres.', { 0: MAX_URL_CHARS }))
    if (account.note.length > MAX_NOTE_CHARS) throw new VaultError('INVALID', t('La nota supera {0} caracteres.', { 0: MAX_NOTE_CHARS }))
    return account
  }

  private checkExpires(expires: string | null): void {
    if (expires !== null && !DATE_PATTERN.test(expires)) throw new VaultError('INVALID', t('Fecha de vencimiento no válida.'))
  }

  private checkFolder(input: FolderInput, selfId: string | null): void {
    if (!input.name.trim()) throw new VaultError('INVALID', t('La carpeta necesita un nombre.'))
    if (!isValidCode(input.code)) throw new VaultError('INVALID_CODE', t('El código va de 2 a 4 letras.'))
    const owner = this.data.folders.find((folder) => folder.id !== selfId && folder.code === input.code)
    if (owner) throw new VaultError('CODE_TAKEN', t('El código {0} ya es de {1}', { 0: input.code, 1: owner.name }))
  }

  private requireUnlocked(): void {
    if (!this.unlocked) throw new VaultError('LOCKED', t('Nautilus está bloqueada.'))
  }

  // ---------- acceso al índice ----------

  private folderById(id: string): Folder {
    const folder = this.data.folders.find((candidate) => candidate.id === id)
    if (!folder) throw new VaultError('NOT_FOUND', t('La carpeta no existe.'))
    return folder
  }

  private varById(id: string): VarMeta {
    const variable = this.data.vars.find((candidate) => candidate.id === id)
    if (!variable) throw new VaultError('NOT_FOUND', t('La variable no existe.'))
    return variable
  }

  private varsIn(folderId: string): VarMeta[] {
    return this.data.vars.filter((variable) => variable.folderId === folderId)
  }

  private nameOf(variable: VarMeta): string {
    return fullName(this.folderById(variable.folderId).code, variable.short)
  }

  /**
   * Cierra cada operación: guarda el índice y el log ANTES de avisar a Windows. El aviso puede tardar (le llega a
   * cada ventana abierta); si Nautilus se corta en medio, el índice ya coincide con el registro.
   */
  private commit(op: string, message: string): void {
    this.save()
    this.log.op(op, message)
    this.publication.flush()
  }

  private save(): void {
    saveIndex(this.indexFile, this.data)
  }
}
