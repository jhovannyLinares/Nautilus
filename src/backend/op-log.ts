import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Una entrada del registro. Nunca lleva un valor ni un PIN: solo nombres de variable, códigos y mensajes de la
 * bóveda, que están escritos sin valores.
 */
export interface LogEntry {
  /** op (operación de la bóveda), rpc (pedido que falló), renderer (error en la ventana), ventana (se cayó), app (arranque) */
  source: 'op' | 'rpc' | 'renderer' | 'ventana' | 'app'
  message: string
  op?: string
  result?: 'ok' | 'error'
  channel?: string
  code?: string
  where?: string
}

/** Tope del archivo; al pasarlo, el actual pasa a `.1` y se empieza otro, así nunca crece sin límite. */
export const MAX_LOG_BYTES = 1_000_000

/**
 * Registro de Nautilus en `userData/logs/nautilus.log`: una línea JSON por entrada (se lee a mano, con grep o tail).
 * Un error idéntico al anterior no se repite: se cuenta y queda «se repitió N veces» antes de la siguiente línea
 * distinta. Mismo diseño que el registro de Fluxo. Nunca lanza: si no se puede escribir, la operación sigue.
 */
export class OpLog {
  private last: { key: string; times: number; until: string } | null = null

  constructor(
    readonly file: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Una operación de la bóveda terminada bien. */
  op(op: string, message: string): void {
    this.write({ source: 'op', op, result: 'ok', message })
  }

  write(entry: LogEntry): void {
    const at = this.now().toISOString()
    const key = JSON.stringify([entry.source, entry.op, entry.channel, entry.code, entry.message])
    if (entry.source !== 'op' && this.last?.key === key) {
      this.last.times++
      this.last.until = at
      return
    }
    this.flushRepeat()
    this.last = entry.source === 'op' ? null : { key, times: 0, until: at }
    this.append(JSON.stringify({ at, ...entry }) + '\n')
  }

  private flushRepeat(): void {
    if (this.last && this.last.times > 0) {
      this.append(JSON.stringify({ at: this.last.until, source: 'repeat', message: `La línea anterior se repitió ${this.last.times} veces más.` }) + '\n')
    }
  }

  private append(line: string): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      if (this.fileSize() > MAX_LOG_BYTES) renameSync(this.file, `${this.file}.1`)
      appendFileSync(this.file, line, 'utf8')
    } catch (error) {
      // sin registro antes que sin app; el fallo queda en la consola de main
      console.error('No se pudo escribir el registro de Nautilus:', error)
    }
  }

  private fileSize(): number {
    try {
      return statSync(this.file).size
    } catch {
      return 0 // todavía no existe
    }
  }
}
