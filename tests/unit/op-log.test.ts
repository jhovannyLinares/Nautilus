import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_LOG_BYTES, OpLog } from '../../src/backend/op-log'

function newLog() {
  const file = join(mkdtempSync(join(tmpdir(), 'nautilus-log-')), 'logs', 'nautilus.log')
  const lines = () => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  return { file, log: new OpLog(file, () => new Date('2026-10-28T12:00:00Z')), lines }
}

describe('registro', () => {
  it('una línea JSON por entrada, con fecha y resultado', () => {
    const { log, lines } = newLog()
    log.op('var-create', 'NAU_UY_INSIS_PASS')
    log.write({ source: 'rpc', channel: 'vault:unlock', code: 'PIN_WRONG', message: 'PIN incorrecto', result: 'error' })
    expect(lines()).toEqual([
      { at: '2026-10-28T12:00:00.000Z', source: 'op', op: 'var-create', result: 'ok', message: 'NAU_UY_INSIS_PASS' },
      { at: '2026-10-28T12:00:00.000Z', source: 'rpc', channel: 'vault:unlock', code: 'PIN_WRONG', message: 'PIN incorrecto', result: 'error' }
    ])
  })

  it('un error repetido se resume en «se repitió N veces»', () => {
    const { log, lines } = newLog()
    const wrongPin = { source: 'rpc', channel: 'vault:unlock', code: 'PIN_WRONG', message: 'PIN incorrecto' } as const
    log.write(wrongPin)
    log.write(wrongPin)
    log.write(wrongPin)
    log.op('unlock', '2 variables publicadas')
    expect(lines().map((line) => line.source)).toEqual(['rpc', 'repeat', 'op'])
    expect(lines()[1].message).toBe('La línea anterior se repitió 2 veces más.')
  })

  it('las operaciones nunca se resumen: cada una deja su línea', () => {
    const { log, lines } = newLog()
    log.op('lock', 'bloqueada')
    log.op('lock', 'bloqueada')
    expect(lines()).toHaveLength(2)
  })

  it('al pasar el tope rota a .1', () => {
    const { file, log } = newLog()
    log.op('unlock', 'primera')
    writeFileSync(file, 'x'.repeat(MAX_LOG_BYTES + 1))
    log.op('lock', 'después de rotar')
    expect(existsSync(file + '.1')).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('después de rotar')
  })
})
