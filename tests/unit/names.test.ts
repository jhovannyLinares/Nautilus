import { describe, expect, it } from 'vitest'
import { daysUntil, fullName, isValidCode, isValidShort, normalizeCode, normalizeShort, valueTooLong, varState } from '@shared/names'

describe('nombres', () => {
  it('normaliza lo que se escribe', () => {
    expect(normalizeShort('insis pass-2')).toBe('INSIS_PASS_2')
    expect(normalizeShort('ñandú$%')).toBe('AND')
    expect(normalizeCode('uy1')).toBe('UY')
    expect(normalizeCode('pacifico')).toBe('PACI')
  })

  it('valida nombre y código', () => {
    expect(isValidShort('INSIS_PASS')).toBe(true)
    expect(isValidShort('_X')).toBe(false)
    expect(isValidShort('')).toBe(false)
    expect(isValidCode('UY')).toBe(true)
    expect(isValidCode('U')).toBe(false)
    expect(isValidCode('ABCDE')).toBe(false)
  })

  it('arma el nombre completo con y sin código', () => {
    expect(fullName('UY', 'INSIS_PASS')).toBe('NAU_UY_INSIS_PASS')
    expect(fullName('', 'AZDO_PAT')).toBe('NAU_AZDO_PAT')
  })

  it('límite de 2560 bytes = 1280 caracteres', () => {
    expect(valueTooLong('x'.repeat(1280))).toBe(false)
    expect(valueTooLong('x'.repeat(1281))).toBe(true)
  })

  it('estados', () => {
    const hoy = new Date(2026, 9, 28)
    expect(daysUntil('2026-11-12', hoy)).toBe(15)
    expect(varState({ hasValue: false, expires: null, fresh: true }, hoy)).toBe('Vacía')
    expect(varState({ hasValue: true, expires: '2026-11-12', fresh: false }, hoy)).toBe('Vence pronto')
    expect(varState({ hasValue: true, expires: '2026-11-13', fresh: false }, hoy)).toBe('Activa')
    expect(varState({ hasValue: true, expires: null, fresh: true }, hoy)).toBe('Nueva')
    expect(varState({ hasValue: true, expires: '2026-10-28', fresh: false }, hoy)).toBe('Vence pronto')
    expect(varState({ hasValue: true, expires: '2026-10-27', fresh: false }, hoy)).toBe('Vencida')
    expect(varState({ hasValue: false, expires: '2026-10-27', fresh: false }, hoy)).toBe('Vacía')
  })
})
