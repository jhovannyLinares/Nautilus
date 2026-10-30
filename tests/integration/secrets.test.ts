import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { credentialStore } from '../../src/backend/secrets'

const PREFIX = `nautilus-test-secrets-${process.pid}:`
const store = credentialStore(PREFIX)
const NAMES = ['NAU_UNO', 'NAU_DOS', 'NAU_VACIA', 'NAU_ASINCRONA']

afterAll(() => {
  for (const name of NAMES) store.delete(name)
}, 30_000)

/** Las líneas de `cmdkey /list` que describen una credencial: desde su destino hasta la siguiente. */
function cmdkeyBlock(target: string): string {
  const lines = execFileSync('cmdkey', ['/list'], { encoding: 'utf8' }).split(/\r?\n/)
  const start = lines.findIndex((line) => line.endsWith('target=' + target))
  if (start < 0) return ''
  const next = lines.findIndex((line, index) => index > start && line.includes('target='))
  return lines.slice(start, next < 0 ? undefined : next).join('\n')
}

describe('credenciales de Windows', () => {
  it('lee desde una instancia nueva lo que escribió otra', () => {
    store.set('NAU_UNO', 'uno-ñ-€')
    store.set('NAU_DOS', 'dos')
    const otherStore = credentialStore(PREFIX)
    expect(otherStore.get('NAU_UNO')).toBe('uno-ñ-€')
    expect(otherStore.get('NAU_DOS')).toBe('dos')
  })

  it('valor vacío y credencial inexistente', () => {
    store.set('NAU_VACIA', '')
    expect(store.get('NAU_VACIA')).toBe('')
    expect(store.get('NAU_NO_EXISTE')).toBeNull()
  })

  it('queda con destino nautilus y persistencia local, no empresarial', () => {
    store.set('NAU_UNO', 'uno')
    const block = cmdkeyBlock(PREFIX + 'NAU_UNO')
    expect(block).not.toBe('')
    // cmdkey solo imprime esta línea para la persistencia local; en inglés dice «Local machine persistence»
    expect(block).toMatch(/Persistencia del equipo local|Local machine persistence/)
  })

  it('las variantes asíncronas escriben, leen y borran igual, sin bloquear el hilo', async () => {
    // si la llamada bloqueara, la promesa se resolvería antes de que corra el temporizador
    const order: string[] = []
    setTimeout(() => order.push('timer'), 0)
    await store.setAsync('NAU_ASINCRONA', 'asíncrona-ñ')
    order.push('escrita')
    expect(order).toEqual(['timer', 'escrita'])

    expect(await store.getAsync('NAU_ASINCRONA')).toBe('asíncrona-ñ')
    expect(store.get('NAU_ASINCRONA')).toBe('asíncrona-ñ')
    expect(cmdkeyBlock(PREFIX + 'NAU_ASINCRONA')).toMatch(/Persistencia del equipo local|Local machine persistence/)
    await store.deleteAsync('NAU_ASINCRONA')
    expect(await store.getAsync('NAU_ASINCRONA')).toBeNull()
  })

  it('borrar la quita del Administrador', () => {
    store.set('NAU_DOS', 'dos')
    store.delete('NAU_DOS')
    expect(store.get('NAU_DOS')).toBeNull()
    expect(cmdkeyBlock(PREFIX + 'NAU_DOS')).toBe('')
  })
})
