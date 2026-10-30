import { describe, expect, it } from 'vitest'
import { AMBIGUOUS_CHARS, CHAR_CLASSES, generatePassword, type PasswordOptions, strengthOf, strengthOfTyped } from '@shared/password'

const ALL_ON: PasswordOptions = { length: 24, enabled: { upper: true, lower: true, digits: true, symbols: true }, noAmbiguous: false }
const SAMPLES = 200

describe('generador de contraseñas', () => {
  it('respeta el largo y trae al menos un carácter de cada tipo elegido', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const password = generatePassword({ ...ALL_ON, length: 8 })
      expect(password).toHaveLength(8)
      for (const charClass of CHAR_CLASSES) expect([...password].some((char) => charClass.chars.includes(char))).toBe(true)
    }
  })

  it('solo usa los tipos elegidos y nunca los símbolos que rompen la consola', () => {
    const onlyDigits = { ...ALL_ON, enabled: { upper: false, lower: false, digits: true, symbols: false } }
    expect(generatePassword(onlyDigits)).toMatch(/^\d{24}$/)
    const allowed = /^[A-Za-z0-9\-_.@#+=]+$/
    for (let i = 0; i < SAMPLES; i++) expect(generatePassword({ ...ALL_ON, length: 64 })).toMatch(allowed)
  })

  it('excluye los caracteres que se confunden', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const password = generatePassword({ ...ALL_ON, length: 64, noAmbiguous: true })
      expect([...password].some((char) => AMBIGUOUS_CHARS.includes(char))).toBe(false)
    }
  })

  it('mide la fortaleza por bits', () => {
    expect(strengthOf(ALL_ON)).toMatchObject({ bits: 147, label: 'Muy fuerte', filledSegments: 10 })
    expect(strengthOf({ ...ALL_ON, length: 8 })).toMatchObject({ bits: 49, label: 'Débil' })
  })

  it('una contraseña escrita se mide por los tipos de carácter que trae', () => {
    // 14 minúsculas: 14 × log2(26) ≈ 66 bits
    expect(strengthOfTyped('abcdefghijklmn')).toMatchObject({ bits: 66, label: 'Aceptable' })
    // con mayúsculas y números el conjunto es de 62
    expect(strengthOfTyped('Abcdefghijklm1')).toMatchObject({ bits: 83, label: 'Fuerte' })
    expect(strengthOfTyped('')).toMatchObject({ bits: 0, label: 'Débil', filledSegments: 0 })
    // un carácter fuera de los cuatro tipos no suma conjunto, pero tampoco rompe la cuenta
    expect(strengthOfTyped('ññññ').bits).toBe(0)
  })
})
