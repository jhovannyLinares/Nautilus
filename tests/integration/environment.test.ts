import { execFileSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { windowsEnvironment } from '../../src/backend/environment'

// HKCU\Environment real, con una variable propia de esta corrida
const NAME = `NAU_TEST_${process.pid}`
const env = windowsEnvironment()

function inRegistry(): boolean {
  try {
    return execFileSync('reg', ['query', 'HKCU\\Environment', '/v', NAME], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes(NAME)
  } catch {
    return false
  }
}

afterAll(() => {
  env.remove(NAME)
  env.flush()
})

describe('variables de entorno de usuario', () => {
  it('publica y retira', () => {
    expect(inRegistry()).toBe(false)
    env.set(NAME, 'valor-de-prueba')
    env.flush()
    expect(inRegistry()).toBe(true)
    env.remove(NAME)
    env.flush()
    expect(inRegistry()).toBe(false)
  })

  it('retirar una que no existe no falla', () => {
    expect(() => env.remove(NAME + '_NO_EXISTE')).not.toThrow()
  })
})
