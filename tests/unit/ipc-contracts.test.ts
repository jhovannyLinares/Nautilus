import { describe, expect, it } from 'vitest'
import { contracts, isChannel } from '@shared/ipc-contracts'

describe('contratos IPC', () => {
  it('reconoce solo los canales declarados', () => {
    expect(isChannel('app:ready')).toBe(true)
    expect(isChannel('app:nada')).toBe(false)
    expect(isChannel('toString')).toBe(false)
    expect(isChannel(42)).toBe(false)
  })

  it('exportar exige PIN, al menos una carpeta y un formato conocido', () => {
    const request = { folderIds: ['general'], format: 'encrypted', password: 'contraseña-larga', pin: '123456', path: 'C:\\x\\a.nau' }
    expect(contracts['vault:export'].req.parse(request)).toEqual(request)
    expect(() => contracts['vault:export'].req.parse({ ...request, pin: undefined })).toThrow()
    expect(() => contracts['vault:export'].req.parse({ ...request, folderIds: [] })).toThrow()
    expect(() => contracts['vault:export'].req.parse({ ...request, format: 'zip' })).toThrow()
  })

  it('aplicar la importación y vaciar exigen PIN', () => {
    expect(() => contracts['vault:importApply'].req.parse({ path: 'C:\\x\\a.nau', password: null, replace: [] })).toThrow()
    expect(() => contracts['vault:wipe'].req.parse({})).toThrow()
    expect(contracts['vault:wipe'].req.parse({ pin: '123456' })).toEqual({ pin: '123456' })
  })

  it('app:ready responde ok: true', () => {
    expect(contracts['app:ready'].res.parse({ ok: true })).toEqual({ ok: true })
    expect(() => contracts['app:ready'].res.parse({ ok: false })).toThrow()
  })
})
