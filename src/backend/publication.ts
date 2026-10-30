import type { EnvPublisher } from './environment'

/**
 * Lo publicado en el entorno. La lista `published` es la misma que guarda index.json: se modifica en el lugar
 * para que retirar solo toque lo que publicó Nautilus, también después de un cierre anormal.
 */
export class Publication {
  /** Publicadas en este desbloqueo por crearlas, renombrarlas o cambiarles el valor. */
  private readonly fresh = new Set<string>()

  constructor(
    private readonly env: EnvPublisher,
    private readonly published: string[]
  ) {}

  get count(): number {
    return this.published.length
  }

  isPublished(name: string): boolean {
    return this.published.includes(name)
  }

  isFresh(name: string): boolean {
    return this.fresh.has(name)
  }

  publish(name: string, value: string, { fresh }: { fresh: boolean }): void {
    this.env.set(name, value)
    if (!this.isPublished(name)) this.published.push(name)
    if (fresh) this.fresh.add(name)
  }

  retire(name: string): void {
    const index = this.published.indexOf(name)
    if (index < 0) return
    this.env.remove(name)
    this.published.splice(index, 1)
    this.fresh.delete(name)
  }

  retireAll(): void {
    for (const name of [...this.published]) this.retire(name)
    this.fresh.clear()
  }

  /** Avisa a Windows del cambio; se llama una vez al final de cada operación. */
  flush(): void {
    this.env.flush()
  }
}
