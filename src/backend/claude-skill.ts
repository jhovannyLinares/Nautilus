import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ClaudeState } from '@shared/view'

/** La marca que deja Nautilus en cada archivo del skill: dice que el archivo es suyo y de qué versión. */
const MARKER_PREFIX = '<!-- nautilus-skill '
const VERSION_PLACEHOLDER = '{{VERSION}}'
const IMPORT_SCRIPT_NAME = 'importar.ps1'

export interface ClaudeSkillOptions {
  /** Carpeta personal donde Claude Code guarda `.claude.json` y `.claude/`. */
  homeDir: string
  /** El texto del skill, con `{{VERSION}}` donde va la versión. */
  template: string
  /** El script con que Claude muda secretos a Nautilus; también lleva `{{VERSION}}`. */
  importScript: string
  version: string
}

interface SkillFile {
  path: string
  content: string
}

/**
 * El skill que le enseña a Claude Code a usar Nautilus: `~/.claude/skills/nautilus/SKILL.md` y su `importar.ps1`.
 * Solo escribe y borra esos archivos, y solo si llevan su marca: no pisa uno que no escribió.
 */
export class ClaudeSkill {
  readonly file: string
  readonly scriptFile: string
  private readonly homeDir: string
  private readonly files: SkillFile[]

  constructor(options: ClaudeSkillOptions) {
    this.homeDir = options.homeDir
    this.file = join(options.homeDir, '.claude', 'skills', 'nautilus', 'SKILL.md')
    this.scriptFile = join(dirname(this.file), IMPORT_SCRIPT_NAME)
    const withVersion = (text: string) => text.replaceAll(VERSION_PLACEHOLDER, options.version)
    this.files = [
      { path: this.file, content: withVersion(options.template) },
      { path: this.scriptFile, content: withVersion(options.importScript) }
    ]
  }

  /** Deja el disco como pide el interruptor: instalado y al día si está encendido, sin el skill si está apagado. */
  sync(enabled: boolean): void {
    if (enabled) this.install()
    else this.remove()
  }

  /**
   * Lo que muestra la barra inferior. Claude Code crea `.claude.json` al usarse por primera vez;
   * la carpeta `.claude` no sirve de señal porque el propio skill la crea.
   */
  state(enabled: boolean): ClaudeState {
    if (!enabled) return 'off'
    return existsSync(join(this.homeDir, '.claude.json')) ? 'on' : 'noclaude'
  }

  private install(): void {
    // se revisan todos antes de escribir: si uno es ajeno, no queda el skill a medias
    const pending = this.files.filter((file) => read(file.path) !== file.content)
    const foreign = pending.find((file) => isForeign(file.path))
    if (foreign) throw new Error(`${foreign.path} existe y no lo escribió Nautilus: no se reemplaza.`)
    for (const file of pending) writeAtomically(file)
  }

  private remove(): void {
    for (const file of this.files) {
      const current = read(file.path)
      if (current === null || !current.includes(MARKER_PREFIX)) continue
      unlinkSync(file.path)
    }
    if (existsSync(dirname(this.file))) removeIfEmpty(dirname(this.file))
  }
}

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function isForeign(path: string): boolean {
  const current = read(path)
  return current !== null && !current.includes(MARKER_PREFIX)
}

/** Escritura atómica, como el índice: Claude nunca lee un archivo del skill a medias. */
function writeAtomically(file: SkillFile): void {
  mkdirSync(dirname(file.path), { recursive: true })
  const tmp = file.path + '.tmp'
  writeFileSync(tmp, file.content, 'utf8')
  renameSync(tmp, file.path)
}

/** La carpeta del skill se va con él, salvo que alguien haya dejado otros archivos adentro. */
function removeIfEmpty(folder: string): void {
  try {
    rmdirSync(folder)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
  }
}
