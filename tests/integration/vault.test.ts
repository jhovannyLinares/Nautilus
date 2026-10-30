import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { EnvPublisher } from '../../src/backend/environment'
import { credentialStore, type SecretStore } from '../../src/backend/secrets'
import { Vault } from '../../src/backend/vault'

// Credenciales reales del Administrador, con un prefijo propio de esta corrida; se borran al final.
const SERVICE = `nautilus-test-${process.pid}:`
const real = credentialStore(SERVICE)
const touched = new Set<string>()
const secrets: SecretStore = {
  get: (n) => real.get(n),
  set: (n, v) => {
    touched.add(n)
    real.set(n, v)
  },
  delete: (n) => real.delete(n),
  getAsync: (n) => real.getAsync(n),
  setAsync: (n, v) => {
    touched.add(n)
    return real.setAsync(n, v)
  },
  deleteAsync: (n) => real.deleteAsync(n)
}
// borrar una credencial tarda ~1,3 s en este equipo (medido el 2026-10-29): 10 s no alcanzan para todas
const CLEANUP_TIMEOUT_MS = 120_000
afterAll(async () => {
  await Promise.all([...touched].map((n) => real.deleteAsync(n)))
}, CLEANUP_TIMEOUT_MS)

/** Publicador falso: anota en memoria lo que estaría en HKCU\Environment. */
function fakeEnv(): EnvPublisher & { vars: Map<string, string>; flushes: number } {
  const vars = new Map<string, string>()
  return {
    vars,
    flushes: 0,
    set: (n, v) => void vars.set(n, v),
    remove: (n) => void vars.delete(n),
    flush() {
      this.flushes++
    }
  }
}

const SECRETO = 'valor-secreto-de-prueba-9f3a'
let dir: string
let env: ReturnType<typeof fakeEnv>
let clock: Date
let v: Vault

function nueva(): Vault {
  return new Vault({ dir, secrets, env, now: () => clock })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nautilus-'))
  env = fakeEnv()
  clock = new Date(2026, 9, 28, 10, 0, 0)
  // el PIN es uno por prefijo: se reemplaza en cada caso
  v = nueva()
  v.resetPin('123456')
})

describe('variables', () => {
  it('crea, publica y lee; el valor no queda en index.json', () => {
    const id = v.createVar({ folderId: 'general', short: 'AZDO_PAT', value: SECRETO, expires: null, publish: true })
    expect(env.vars.get('NAU_AZDO_PAT')).toBe(SECRETO)
    expect(v.reveal(id, '123456')).toBe(SECRETO)
    expect(v.snapshot().vars[0]).toMatchObject({ name: 'NAU_AZDO_PAT', state: 'Nueva' })
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).not.toContain(SECRETO)
  })

  it('rechaza nombre inválido, nombre repetido y valor demasiado largo', () => {
    v.createVar({ folderId: 'general', short: 'X1', value: 'a', expires: null, publish: true })
    expect(() => v.createVar({ folderId: 'general', short: '_X', value: 'a', expires: null, publish: true })).toThrow(/solo admite/)
    expect(() => v.createVar({ folderId: 'general', short: 'X1', value: 'b', expires: null, publish: true })).toThrow('Ya existe NAU_X1')
    expect(() => v.createVar({ folderId: 'general', short: 'X2', value: 'x'.repeat(1281), expires: null, publish: true })).toThrow(/límite/)
  })

  it('valor vacío = Vacía y no se publica', () => {
    v.createVar({ folderId: 'general', short: 'OIC_TOKEN', value: '', expires: null, publish: true })
    expect(env.vars.size).toBe(0)
    expect(v.snapshot().vars[0]?.state).toBe('Vacía')
  })

  it('renombrar mueve la credencial y la variable publicada', () => {
    const id = v.createVar({ folderId: 'general', short: 'PWD', value: SECRETO, expires: null, publish: true })
    v.updateVar(id, { folderId: 'general', short: 'PASS', value: null, expires: null, publish: true })
    expect(env.vars.has('NAU_PWD')).toBe(false)
    expect(env.vars.get('NAU_PASS')).toBe(SECRETO)
    expect(real.get('NAU_PWD')).toBeNull()
    expect(v.reveal(id, '123456')).toBe(SECRETO)
  })

  it('eliminar borra la credencial y retira la variable', () => {
    const id = v.createVar({ folderId: 'general', short: 'BORRAR', value: SECRETO, expires: null, publish: true })
    v.deleteVar(id)
    expect(env.vars.size).toBe(0)
    expect(real.get('NAU_BORRAR')).toBeNull()
  })

  it('Vence pronto a 15 días o menos', () => {
    v.createVar({ folderId: 'general', short: 'PAT', value: 'a', expires: '2026-11-12', publish: true })
    expect(v.snapshot().vars[0]?.state).toBe('Vence pronto')
  })
})

describe('dónde vive', () => {
  it('sin publicar: queda solo en el Administrador y desbloquear no la publica', () => {
    const id = v.createVar({ folderId: 'general', short: 'SOLO_ADM', value: SECRETO, expires: null, publish: false })
    expect(env.vars.size).toBe(0)
    expect(real.get('NAU_SOLO_ADM')).toBe(SECRETO)
    expect(v.snapshot().vars[0]).toMatchObject({ publish: false, state: 'Activa' })
    v.lock()
    v.unlock('123456')
    expect(env.vars.size).toBe(0)
    expect(v.reveal(id, '123456')).toBe(SECRETO)
  })

  it('marcar y desmarcar la casilla publica y retira sin tocar el valor', () => {
    const id = v.createVar({ folderId: 'general', short: 'CAMBIA', value: SECRETO, expires: null, publish: false })
    v.updateVar(id, { folderId: 'general', short: 'CAMBIA', value: null, expires: null, publish: true })
    expect(env.vars.get('NAU_CAMBIA')).toBe(SECRETO)
    v.updateVar(id, { folderId: 'general', short: 'CAMBIA', value: null, expires: null, publish: false })
    expect(env.vars.has('NAU_CAMBIA')).toBe(false)
    expect(real.get('NAU_CAMBIA')).toBe(SECRETO)
  })

  it('cambiar el valor de una publicada publica el valor nuevo', () => {
    const id = v.createVar({ folderId: 'general', short: 'ROTA', value: 'viejo', expires: null, publish: true })
    v.updateVar(id, { folderId: 'general', short: 'ROTA', value: SECRETO, expires: null, publish: true })
    expect(env.vars.get('NAU_ROTA')).toBe(SECRETO)
  })

  it('una sin publicar no se publica al cambiar el código de su carpeta', () => {
    const f = v.createFolder({ name: 'Uruguay', code: 'UY', color: '#7bd938' })
    v.createVar({ folderId: f, short: 'OCULTA', value: SECRETO, expires: null, publish: false })
    v.updateFolder(f, { name: 'Uruguay', code: 'URU', color: '#7bd938' })
    expect(env.vars.size).toBe(0)
    expect(real.get('NAU_URU_OCULTA')).toBe(SECRETO)
  })

  it('un índice anterior a la opción deja sus variables publicadas', () => {
    v.createVar({ folderId: 'general', short: 'VIEJA', value: SECRETO, expires: null, publish: true })
    const file = join(dir, 'index.json')
    const old = JSON.parse(readFileSync(file, 'utf8'))
    for (const variable of old.vars) delete variable.publish
    writeFileSync(file, JSON.stringify(old))
    const reopened = nueva()
    reopened.cleanupOnStart()
    reopened.unlock('123456')
    expect(env.vars.get('NAU_VIEJA')).toBe(SECRETO)
    expect(reopened.snapshot().vars[0]?.publish).toBe(true)
  })
})

describe('carpetas', () => {
  it('cambiar el código renombra sus variables', () => {
    const f = v.createFolder({ name: 'Uruguay', code: 'UY', color: '#7bd938' })
    v.createVar({ folderId: f, short: 'INSIS_PASS', value: SECRETO, expires: null, publish: true })
    v.updateFolder(f, { name: 'Uruguay', code: 'URU', color: '#7bd938' })
    expect(v.snapshot().vars.map((x) => x.name)).toEqual(['NAU_URU_INSIS_PASS'])
    expect(env.vars.get('NAU_URU_INSIS_PASS')).toBe(SECRETO)
    expect(env.vars.has('NAU_UY_INSIS_PASS')).toBe(false)
  })

  it('código repetido se rechaza', () => {
    v.createFolder({ name: 'Uruguay', code: 'UY', color: '#7bd938' })
    expect(() => v.createFolder({ name: 'Otra', code: 'UY', color: '#7bd938' })).toThrow('El código UY ya es de Uruguay')
  })

  it('mover a General con choque de nombre no cambia nada', () => {
    const f = v.createFolder({ name: 'Uruguay', code: 'UY', color: '#7bd938' })
    v.createVar({ folderId: 'general', short: 'INSIS_PASS', value: 'general', expires: null, publish: true })
    v.createVar({ folderId: f, short: 'INSIS_PASS', value: 'uy', expires: null, publish: true })
    expect(() => v.deleteFolder(f, 'move')).toThrow('Ya existe NAU_INSIS_PASS')
    expect(v.snapshot().folders.map((x) => x.code)).toContain('UY')
    expect(env.vars.get('NAU_UY_INSIS_PASS')).toBe('uy')
  })

  it('borrar moviendo a General quita el código', () => {
    const f = v.createFolder({ name: 'Panamá', code: 'PA', color: '#c517b6' })
    v.createVar({ folderId: f, short: 'M365_PASS', value: SECRETO, expires: null, publish: true })
    v.deleteFolder(f, 'move')
    expect(v.snapshot().vars[0]).toMatchObject({ name: 'NAU_M365_PASS', folderId: 'general' })
    expect(env.vars.get('NAU_M365_PASS')).toBe(SECRETO)
  })

  it('borrar eliminando borra sus variables', () => {
    const f = v.createFolder({ name: 'México', code: 'MX', color: '#f2ca33' })
    v.createVar({ folderId: f, short: 'X', value: SECRETO, expires: null, publish: true })
    v.deleteFolder(f, 'drop')
    expect(v.snapshot().vars).toHaveLength(0)
    expect(real.get('NAU_MX_X')).toBeNull()
  })

  it('General no se borra ni lleva código', () => {
    expect(() => v.deleteFolder('general', 'drop')).toThrow('General no se puede borrar.')
    expect(() => v.updateFolder('general', { name: 'General', code: 'GE', color: '#4d88ff' })).toThrow('General no lleva código.')
  })
})

describe('exportar, importar y vaciar', () => {
  const PIN = '123456'
  const FILE_PASSWORD = 'contraseña-del-archivo-larga'

  /** General con una publicada y Uruguay con una solo en el Administrador, con vencimiento, y una vacía. */
  function seed(): { uy: string } {
    const uy = v.createFolder({ name: 'Uruguay', code: 'UY', color: '#7bd938' })
    v.createVar({ folderId: 'general', short: 'AZDO_PAT', value: SECRETO, expires: null, publish: true })
    v.createVar({ folderId: uy, short: 'DEV_AMX', value: 'clave "con" espacios', expires: '2027-01-15', publish: false })
    v.createVar({ folderId: uy, short: 'VACIA', value: '', expires: null, publish: false })
    return { uy }
  }

  async function exportAll(format: 'encrypted' | 'plain' | 'names'): Promise<string> {
    const folderIds = v.snapshot().folders.map((folder) => folder.id)
    return (await v.exportText({ folderIds, format, password: format === 'encrypted' ? FILE_PASSWORD : null }, PIN)).text
  }

  /** Lo que la bóveda tiene, sin ids ni fechas: nombre, dónde vive, vencimiento y valor. */
  function contents(): unknown[] {
    return v.snapshot().vars.map((variable) => ({
      name: variable.name,
      publish: variable.publish,
      expires: variable.expires,
      value: v.reveal(variable.id, PIN)
    }))
  }

  it('exportar, vaciar e importar devuelve los mismos valores, carpetas, dónde vive y vencimiento', async () => {
    seed()
    const before = contents()
    const file = await exportAll('encrypted')
    expect(file).not.toContain(SECRETO)

    await v.wipe(PIN)
    expect(v.snapshot().vars).toHaveLength(0)
    expect(await v.importPreview(file, FILE_PASSWORD)).toEqual({
      rows: [
        { name: 'NAU_AZDO_PAT', kind: 'new', createsFolder: null },
        { name: 'NAU_UY_DEV_AMX', kind: 'new', createsFolder: 'Uruguay (UY)' },
        { name: 'NAU_UY_VACIA', kind: 'new', createsFolder: 'Uruguay (UY)' }
      ],
      sameCount: 0,
      newFolders: ['Uruguay (UY)']
    })
    const progress: number[] = []
    expect(await v.importApply(file, FILE_PASSWORD, [], PIN, (done) => progress.push(done))).toEqual({ created: 3, replaced: 0, interrupted: false })
    expect(progress).toEqual([1, 2, 3])
    expect(contents()).toEqual(before)
    expect(v.snapshot().folders.find((folder) => folder.code === 'UY')).toMatchObject({ name: 'Uruguay', color: '#7bd938' })
    expect(env.vars.get('NAU_AZDO_PAT')).toBe(SECRETO)
    expect(env.vars.has('NAU_UY_DEV_AMX')).toBe(false)
  })

  it('las iguales se omiten; las de otro valor se conservan salvo que se pida reemplazar', async () => {
    seed()
    const file = await exportAll('encrypted')
    const [pat, amx] = v.snapshot().vars.filter((variable) => variable.hasValue)
    v.updateVar(pat!.id, { folderId: 'general', short: 'AZDO_PAT', value: 'token-nuevo', expires: null, publish: true })
    v.updateVar(amx!.id, { folderId: amx!.folderId, short: 'DEV_AMX', value: 'otra', expires: '2027-01-15', publish: false })

    const preview = await v.importPreview(file, FILE_PASSWORD)
    expect(preview.rows.map((row) => [row.name, row.kind])).toEqual([
      ['NAU_AZDO_PAT', 'different'],
      ['NAU_UY_DEV_AMX', 'different']
    ])
    expect(preview.sameCount).toBe(1)

    expect(await v.importApply(file, FILE_PASSWORD, ['NAU_AZDO_PAT'], PIN)).toEqual({ created: 0, replaced: 1, interrupted: false })
    expect(v.reveal(pat!.id, PIN)).toBe(SECRETO)
    expect(env.vars.get('NAU_AZDO_PAT')).toBe(SECRETO)
    expect(v.reveal(amx!.id, PIN)).toBe('otra')
  })

  it('una carpeta del archivo se reconoce por su código aunque aquí se llame distinto', async () => {
    seed()
    const file = await exportAll('encrypted')
    await v.wipe(PIN)
    const local = v.createFolder({ name: 'Uruguay DEV', code: 'UY', color: '#c517b6' })
    const preview = await v.importPreview(file, FILE_PASSWORD)
    expect(preview.newFolders).toEqual([])
    await v.importApply(file, FILE_PASSWORD, [], PIN)
    expect(v.snapshot().folders.filter((folder) => folder.code === 'UY')).toEqual([expect.objectContaining({ id: local, name: 'Uruguay DEV', count: 2 })])
  })

  it('un archivo sin valores crea las nuevas Vacías y no pisa ninguna existente', async () => {
    seed()
    const file = await exportAll('names')
    expect(file).not.toContain(SECRETO)
    expect(await v.importPreview(file, null)).toMatchObject({ rows: [], sameCount: 3 })
    await v.wipe(PIN)
    await v.importApply(file, null, [], PIN)
    expect(v.snapshot().vars.map((variable) => [variable.name, variable.state])).toEqual([
      ['NAU_AZDO_PAT', 'Vacía'],
      ['NAU_UY_DEV_AMX', 'Vacía'],
      ['NAU_UY_VACIA', 'Vacía']
    ])
  })

  it('el .env trae los valores de las carpetas elegidas y nada más', async () => {
    const { uy } = seed()
    const { text } = await v.exportText({ folderIds: [uy], format: 'plain', password: null }, PIN)
    expect(text).toContain('# Uruguay (UY)\nNAU_UY_DEV_AMX="clave \\"con\\" espacios"\nNAU_UY_VACIA=\n')
    expect(text).not.toContain('AZDO_PAT')
  })

  it('exportar, importar y vaciar piden el PIN', async () => {
    seed()
    const file = await exportAll('encrypted')
    await expect(v.exportText({ folderIds: ['general'], format: 'plain', password: null }, '000000')).rejects.toThrow('PIN incorrecto')
    await expect(v.importApply(file, FILE_PASSWORD, [], '000000')).rejects.toThrow('PIN incorrecto')
    await expect(v.wipe('000000')).rejects.toThrow('PIN incorrecto')
    expect(v.snapshot().vars).toHaveLength(3)
  })

  it('un archivo con un nombre inválido no importa nada', async () => {
    v.createVar({ folderId: 'general', short: 'BIEN', value: SECRETO, expires: null, publish: false })
    const file = JSON.parse(await exportAll('names'))
    file.content.vars.push({ folderCode: '', short: '_MAL', value: null, publish: false, expires: null })
    file.variables = file.content.vars.length
    await v.wipe(PIN)
    await expect(v.importApply(JSON.stringify(file), null, [], PIN)).rejects.toThrow('nombre _MAL')
    expect(v.snapshot().vars).toHaveLength(0)
  })

  it('bloquearse en medio de vaciar corta ahí: lo borrado sale del índice y el resto queda intacto', async () => {
    seed()
    const result = await v.wipe(PIN, (done) => done === 1 && v.lock())
    expect(result).toEqual({ deleted: 1, interrupted: true })
    v.unlock(PIN)
    const left = v.snapshot().vars
    expect(left).toHaveLength(2)
    expect(left.map((variable) => v.reveal(variable.id, PIN))).toContain('clave "con" espacios')
    expect(v.snapshot().folders.some((folder) => folder.code === 'UY')).toBe(true)
  })

  it('vaciar borra solo lo de Nautilus y conserva PIN, ajustes y General', async () => {
    seed()
    v.setAutoLock(30)
    // control negativo: una credencial con el mismo prefijo y una variable de entorno que Nautilus no creó
    secrets.set('NAU_AJENA', 'no-es-de-nautilus')
    env.vars.set('NAU_A_MANO', 'tampoco')

    await v.wipe(PIN)
    expect(v.snapshot().vars).toHaveLength(0)
    expect(v.snapshot().folders.map((folder) => folder.id)).toEqual(['general'])
    expect(real.get('NAU_AZDO_PAT')).toBeNull()
    expect(real.get('NAU_UY_DEV_AMX')).toBeNull()
    expect(env.vars.has('NAU_AZDO_PAT')).toBe(false)
    expect(real.get('NAU_AJENA')).toBe('no-es-de-nautilus')
    expect(env.vars.get('NAU_A_MANO')).toBe('tampoco')
    expect(v.status().autoLockMin).toBe(30)
    v.lock()
    v.unlock(PIN)
    expect(v.isUnlocked()).toBe(true)
  })

  it('el registro anota exportar, importar y vaciar sin valores ni contraseña', async () => {
    seed()
    const file = await exportAll('encrypted')
    await v.wipe(PIN)
    await v.importApply(file, FILE_PASSWORD, [], PIN)
    const logs = readdirSync(join(dir, 'logs')).map((name) => readFileSync(join(dir, 'logs', name), 'utf8')).join('')
    const ops = logs.trim().split('\n').map((line) => JSON.parse(line).op)
    expect(ops).toEqual(expect.arrayContaining(['export', 'wipe', 'import']))
    expect(logs).not.toContain(SECRETO)
    expect(logs).not.toContain(FILE_PASSWORD)
  })
})

describe('PIN y bloqueo', () => {
  it('bloquear retira todo; desbloquear vuelve a publicar', () => {
    v.createVar({ folderId: 'general', short: 'A', value: SECRETO, expires: null, publish: true })
    v.lock()
    expect(env.vars.size).toBe(0)
    expect(() => v.snapshot()).toThrow('Nautilus está bloqueada.')
    v.unlock('123456')
    expect(env.vars.get('NAU_A')).toBe(SECRETO)
    expect(v.snapshot().vars[0]?.state).toBe('Activa')
  })

  it('3 fallos obligan a esperar 30 s, y la espera se duplica', () => {
    v.lock()
    expect(() => v.unlock('000000')).toThrow('te quedan 2 intentos')
    expect(() => v.unlock('000000')).toThrow('te queda 1 intento')
    expect(() => v.unlock('000000')).toThrow('espera 30 s')
    expect(() => v.unlock('123456')).toThrow(/Espera 30 s/)
    clock = new Date(clock.getTime() + 30_000)
    for (let i = 0; i < 2; i++) expect(() => v.unlock('000000')).toThrow('PIN incorrecto')
    expect(() => v.unlock('000000')).toThrow('espera 60 s')
    clock = new Date(clock.getTime() + 60_000)
    v.unlock('123456')
    expect(v.isUnlocked()).toBe(true)
  })

  it('al arrancar retira lo que quedó publicado por un cierre anormal', () => {
    v.createVar({ folderId: 'general', short: 'QUEDO', value: SECRETO, expires: null, publish: true })
    // otra instancia arranca sin que la anterior haya bloqueado
    const despues = nueva()
    expect(despues.cleanupOnStart()).toBe(1)
    expect(env.vars.size).toBe(0)
  })

  it('integración con Claude: encendida por defecto y el cambio sobrevive al reinicio', () => {
    expect(v.claudeSkillEnabled()).toBe(true)
    v.setClaudeSkill(false)
    expect(nueva().claudeSkillEnabled()).toBe(false)
  })

  it('bloqueo automático por tiempo sin uso', () => {
    v.setAutoLock(5)
    clock = new Date(clock.getTime() + 4 * 60_000)
    expect(v.idleExpired()).toBe(false)
    clock = new Date(clock.getTime() + 60_000)
    expect(v.idleExpired()).toBe(true)
  })

  it('el registro anota cada operación con su nombre y nunca un valor ni el PIN', () => {
    v.createVar({ folderId: 'general', short: 'LOG', value: SECRETO, expires: null, publish: true })
    v.lock()
    expect(() => v.unlock('000000')).toThrow('PIN incorrecto')
    v.unlock('123456')
    const logs = readdirSync(join(dir, 'logs')).map((file) => readFileSync(join(dir, 'logs', file), 'utf8')).join('')
    const entries = logs.trim().split('\n').map((line) => JSON.parse(line))
    expect(entries).toContainEqual(expect.objectContaining({ source: 'op', op: 'var-create', message: 'NAU_LOG', result: 'ok' }))
    expect(entries.map((entry) => entry.op)).toEqual(expect.arrayContaining(['lock', 'unlock']))
    expect(logs).not.toContain(SECRETO)
    expect(logs).not.toContain('123456')
  })
})

describe('PIN para mostrar y copiar', () => {
  it('por defecto se pide: sin PIN o con uno incorrecto no sale el valor', () => {
    const id = v.createVar({ folderId: 'general', short: 'CON_PIN', value: SECRETO, expires: null, publish: false })
    expect(v.status().pinForValues).toBe(true)
    expect(() => v.reveal(id, null)).toThrow('Escribe tu PIN')
    expect(() => v.reveal(id, '000000')).toThrow('PIN incorrecto')
    expect(v.reveal(id, '123456')).toBe(SECRETO)
  })

  it('apagarla exige el PIN correcto; si falla, sigue encendida', () => {
    expect(() => v.setPinForValues(false, null)).toThrow('Escribe tu PIN')
    expect(() => v.setPinForValues(false, '000000')).toThrow('PIN incorrecto')
    expect(v.status().pinForValues).toBe(true)
  })

  it('apagada, el valor sale sin PIN mientras está desbloqueada, y el cambio sobrevive al reinicio', () => {
    const id = v.createVar({ folderId: 'general', short: 'SIN_PIN', value: SECRETO, expires: null, publish: false })
    v.setPinForValues(false, '123456')
    expect(v.reveal(id, null)).toBe(SECRETO)
    expect(nueva().status().pinForValues).toBe(false)
    v.lock()
    expect(() => v.reveal(id, null)).toThrow('Nautilus está bloqueada.')
  })

  it('encenderla no pide PIN', () => {
    v.setPinForValues(false, '123456')
    v.setPinForValues(true, null)
    expect(v.status().pinForValues).toBe(true)
  })
})

describe('datos de la cuenta', () => {
  const PIN = '123456'

  function accountOf(id: string): { user: string; url: string; note: string } {
    const variable = v.snapshot().vars.find((candidate) => candidate.id === id)!
    return { user: variable.user, url: variable.url, note: variable.note }
  }

  it('se guardan recortados, sin cifrar y sin el valor, y se conservan al editar sin mandarlos', () => {
    const id = v.createVar({ folderId: 'general', short: 'CUENTA', value: SECRETO, expires: null, publish: false, user: ' INSIS_GEN_V10 ', url: 'jdbc:oracle:thin:@dev', note: 'DEV de Uruguay' })
    expect(accountOf(id)).toEqual({ user: 'INSIS_GEN_V10', url: 'jdbc:oracle:thin:@dev', note: 'DEV de Uruguay' })

    // mover de carpeta no manda los datos de la cuenta: no se pierden
    v.updateVar(id, { folderId: 'general', short: 'CUENTA', value: null, expires: null, publish: false })
    expect(accountOf(id)).toEqual({ user: 'INSIS_GEN_V10', url: 'jdbc:oracle:thin:@dev', note: 'DEV de Uruguay' })

    v.updateVar(id, { folderId: 'general', short: 'CUENTA', value: null, expires: null, publish: false, note: '' })
    expect(accountOf(id).note).toBe('')

    const index = readFileSync(join(dir, 'index.json'), 'utf8')
    expect(index).toContain('INSIS_GEN_V10')
    expect(index).not.toContain(SECRETO)
  })

  it('rechaza una nota demasiado larga', () => {
    expect(() => v.createVar({ folderId: 'general', short: 'LARGA', value: 'a', expires: null, publish: false, note: 'x'.repeat(501) })).toThrow(/nota supera/)
  })

  it('un índice anterior sin estos campos carga con los campos vacíos', () => {
    const id = v.createVar({ folderId: 'general', short: 'ANTIGUA', value: SECRETO, expires: null, publish: false, note: 'se borra' })
    const indexFile = join(dir, 'index.json')
    const index = JSON.parse(readFileSync(indexFile, 'utf8'))
    for (const variable of index.vars) {
      delete variable.user
      delete variable.url
      delete variable.note
    }
    writeFileSync(indexFile, JSON.stringify(index))
    v = nueva()
    v.unlock(PIN)
    expect(accountOf(id)).toEqual({ user: '', url: '', note: '' })
  })

  it('viajan en el .nau: exportar, vaciar e importar los devuelve', async () => {
    v.createVar({ folderId: 'general', short: 'VIAJA', value: SECRETO, expires: null, publish: false, user: 'svc', url: 'https://x', note: 'nota' })
    const { text } = await v.exportText({ folderIds: ['general'], format: 'encrypted', password: 'contraseña-del-archivo-larga' }, PIN)
    await v.wipe(PIN)
    await v.importApply(text, 'contraseña-del-archivo-larga', [], PIN)
    const imported = v.snapshot().vars.find((variable) => variable.short === 'VIAJA')!
    expect(accountOf(imported.id)).toEqual({ user: 'svc', url: 'https://x', note: 'nota' })
  })
})

describe('bloqueo con fallo al retirar', () => {
  it('queda bloqueada aunque falle el entorno, y lo pendiente se retira al próximo arranque', () => {
    v.createVar({ folderId: 'general', short: 'PUBLICADA', value: SECRETO, expires: null, publish: true })
    env.remove = () => {
      throw new Error('No se pudo retirar NAU_PUBLICADA (código 5).')
    }
    expect(() => v.lock()).toThrow('código 5')
    expect(v.isUnlocked()).toBe(false)
    expect(() => v.snapshot()).toThrow('Nautilus está bloqueada.')

    env.remove = (name) => void env.vars.delete(name)
    expect(nueva().cleanupOnStart()).toBe(1)
    expect(env.vars.has('NAU_PUBLICADA')).toBe(false)
  })
})
