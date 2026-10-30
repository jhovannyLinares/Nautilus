import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { EnvPublisher } from '../../src/backend/environment'
import { credentialStore } from '../../src/backend/secrets'
import { Vault } from '../../src/backend/vault'

// El script real que viaja con el skill, contra credenciales con un prefijo propio de esta corrida.
const SCRIPT = resolve(__dirname, '../../resources/claude/importar.ps1')
const PREFIX = `nautilus-test-imp-${process.pid}:`
const SOURCE_PREFIX = `nautilus-test-src-${process.pid}:`
const store = credentialStore(PREFIX)
const sourceStore = credentialStore(SOURCE_PREFIX)
const IMPORTED_NAMES = ['NAU_UY_DEV_A', 'NAU_UY_DEV_B', 'NAU_CRED', 'NAU_YA_ESTA', '__PIN']
const PIN = '123456'
const BOM = '﻿'
const ORIGINAL_CONFIG = `${BOM}# conexiones\r\ndev.schema.A=valor-a-1\r\ndev.schema.B=valor#b#2\r\notra.clave=sigue-igual\r\ndev.schema.BS=con\\barra\r\n`
// lanzar PowerShell y compilar el Add-Type tarda varios segundos en frío
const SCRIPT_TIMEOUT_MS = 60_000

afterAll(() => {
  for (const name of IMPORTED_NAMES) store.delete(name)
  sourceStore.delete('ORIGEN')
})

const noEnv: EnvPublisher = { set: () => {}, remove: () => {}, flush: () => {} }

let dir: string
let config: string
let list: string

function runImport(apply: boolean): string {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-List', list, '-DataDir', dir, '-CredentialPrefix', PREFIX]
  if (apply) args.push('-Apply')
  const run = spawnSync('powershell', args, { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`importar.ps1 salió con ${run.status}: ${run.stderr}`)
  return run.stdout
}

function writeList(items: object[]): void {
  writeFileSync(list, JSON.stringify({ items }))
}

function openVault(): Vault {
  const vault = new Vault({ dir, secrets: store, env: noEnv })
  vault.resetPin(PIN)
  return vault
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nautilus-importar-'))
  config = join(dir, 'config.env')
  list = join(dir, 'lista.json')
  writeFileSync(config, ORIGINAL_CONFIG)
  sourceStore.set('ORIGEN', 'valor-cred-3')
  for (const name of IMPORTED_NAMES) store.delete(name)
  writeList([
    { folder: 'Uruguay', code: 'UY', short: 'DEV_A', replace: true, source: { type: 'file', path: config, key: 'dev.schema.A' } },
    { folder: 'Uruguay', code: 'UY', short: 'DEV_B', replace: true, source: { type: 'file', path: config, key: 'dev.schema.B' } },
    { folder: 'Uruguay', code: 'UY', short: 'DEV_BS', replace: true, source: { type: 'file', path: config, key: 'dev.schema.BS' } },
    { folder: 'General', code: '', short: 'CRED', source: { type: 'credential', target: `${SOURCE_PREFIX}ORIGEN` } },
    { folder: 'Uruguay', code: 'UY', short: 'DEV_A', source: { type: 'file', path: config, key: 'dev.schema.A' } }
  ])
})

describe('importar.ps1', () => {
  it('sin -Apply no cambia nada y no muestra valores', { timeout: SCRIPT_TIMEOUT_MS }, () => {
    const output = runImport(false)
    expect(output).toContain('Vista previa')
    expect(existsSync(join(dir, 'index.json'))).toBe(false)
    expect(readFileSync(config, 'utf8')).toBe(ORIGINAL_CONFIG)
    expect(store.get('NAU_UY_DEV_A')).toBeNull()
    for (const secret of ['valor-a-1', 'valor#b#2', 'valor-cred-3', 'con\\barra']) expect(output).not.toContain(secret)
  })

  it('con -Apply crea las claves en su carpeta, solo en el Administrador, y Nautilus las abre', { timeout: SCRIPT_TIMEOUT_MS }, () => {
    const output = runImport(true)
    const vault = openVault()
    const vars = vault.snapshot().vars
    expect(vars.map((variable) => variable.name)).toEqual(['NAU_CRED', 'NAU_UY_DEV_A', 'NAU_UY_DEV_B'])
    expect(vars.every((variable) => !variable.publish)).toBe(true)
    expect(vault.snapshot().folders.map((folder) => folder.code)).toContain('UY')
    const byName = Object.fromEntries(vars.map((variable) => [variable.name, variable.id]))
    expect(vault.reveal(byName.NAU_UY_DEV_A!, PIN)).toBe('valor-a-1')
    expect(vault.reveal(byName.NAU_UY_DEV_B!, PIN)).toBe('valor#b#2')
    expect(vault.reveal(byName.NAU_CRED!, PIN)).toBe('valor-cred-3')
    expect(output).toContain('repetida en la lista')
    expect(output).toContain('creala a mano')
    for (const secret of ['valor-a-1', 'valor#b#2', 'valor-cred-3']) expect(output).not.toContain(secret)
  })

  it('reemplaza por la referencia solo las claves pedidas, conserva BOM y CRLF, y guarda copia', { timeout: SCRIPT_TIMEOUT_MS }, () => {
    runImport(true)
    const expected = `${BOM}# conexiones\r\ndev.schema.A=\${NAU_UY_DEV_A}\r\ndev.schema.B=\${NAU_UY_DEV_B}\r\notra.clave=sigue-igual\r\ndev.schema.BS=con\\barra\r\n`
    expect(readFileSync(config, 'utf8')).toBe(expected)
    const backups = join(dir, 'importar')
    const run = readdirSync(backups)[0]!
    expect(readFileSync(join(backups, run, '01_config.env'), 'utf8')).toBe(ORIGINAL_CONFIG)
  })

  it('una clave existente con otro valor no se pisa, ni al repetir la importación', { timeout: SCRIPT_TIMEOUT_MS }, () => {
    const vault = openVault()
    vault.createVar({ folderId: 'general', short: 'YA_ESTA', value: 'valor-propio', expires: null, publish: false })
    vault.lock()
    writeList([{ folder: 'General', code: '', short: 'YA_ESTA', source: { type: 'credential', target: `${SOURCE_PREFIX}ORIGEN` } }])
    expect(runImport(true)).toContain('CONFLICTO')
    expect(runImport(true)).toContain('CONFLICTO')
    expect(store.get('NAU_YA_ESTA')).toBe('valor-propio')
    const reopened = new Vault({ dir, secrets: store, env: noEnv })
    reopened.unlock(PIN)
    expect(reopened.snapshot().vars).toHaveLength(1)
  })
})
