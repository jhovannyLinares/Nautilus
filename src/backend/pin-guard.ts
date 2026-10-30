import { t } from '@shared/i18n'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isValidPin, PIN_RULE_TEXT } from '@shared/names'
import { VaultError } from './errors'
import type { SecretStore } from './secrets'

/** Nombre de la credencial que guarda el hash del PIN. Ninguna variable puede llamarse así: todas empiezan por NAU_. */
const PIN_SECRET_NAME = '__PIN'
const HASH_FORMAT = 's1'
const HASH_BYTES = 32
const SALT_BYTES = 16
const TRIES_BEFORE_WAIT = 3
const FIRST_WAIT_MS = 30_000

/**
 * El PIN de Nautilus: se guarda como hash scrypt con sal, nunca el PIN.
 * Tras 3 intentos fallidos hay que esperar 30 s, y la espera se duplica en cada tanda.
 */
export class PinGuard {
  private failedTries = 0
  private waitRounds = 0
  private waitUntilMs = 0

  constructor(
    private readonly secrets: SecretStore,
    private readonly now: () => Date
  ) {}

  hasPin(): boolean {
    return this.secrets.get(PIN_SECRET_NAME) !== null
  }

  create(pin: string): void {
    if (this.hasPin()) throw new VaultError('PIN_EXISTS', t('Ya hay un PIN creado.'))
    this.store(pin)
  }

  /** «Olvidé mi PIN»: reemplaza el PIN y olvida los intentos fallidos. */
  replace(pin: string): void {
    this.store(pin)
    this.failedTries = 0
    this.waitRounds = 0
    this.waitUntilMs = 0
  }

  verify(pin: string): void {
    const nowMs = this.now().getTime()
    if (nowMs < this.waitUntilMs) {
      throw new VaultError('PIN_WAIT', t('Espera {0} s antes de volver a intentar.', { 0: Math.ceil((this.waitUntilMs - nowMs) / 1000) }))
    }
    if (this.matches(pin)) {
      this.failedTries = 0
      this.waitRounds = 0
      return
    }
    this.registerFailure(nowMs)
  }

  private matches(pin: string): boolean {
    const stored = this.secrets.get(PIN_SECRET_NAME)
    if (stored === null) throw new VaultError('NO_PIN', t('Todavía no hay PIN.'))
    const [, salt = '', hash = ''] = stored.split('$')
    const expected = Buffer.from(hash, 'base64')
    const actual = scryptSync(pin, Buffer.from(salt, 'base64'), HASH_BYTES)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private registerFailure(nowMs: number): never {
    this.failedTries++
    const waitMs = FIRST_WAIT_MS * 2 ** this.waitRounds
    if (this.failedTries >= TRIES_BEFORE_WAIT) {
      this.failedTries = 0
      this.waitRounds++
      this.waitUntilMs = nowMs + waitMs
      throw new VaultError('PIN_WAIT', t('PIN incorrecto · espera {0} s antes de volver a intentar.', { 0: waitMs / 1000 }))
    }
    const left = TRIES_BEFORE_WAIT - this.failedTries
    const triesText = left === 1 ? t('queda 1 intento') : t('quedan {0} intentos', { 0: left })
    throw new VaultError('PIN_WRONG', t('PIN incorrecto · te {0} antes de esperar {1} s', { 0: triesText, 1: waitMs / 1000 }))
  }

  private store(pin: string): void {
    if (!isValidPin(pin)) throw new VaultError('INVALID_PIN', PIN_RULE_TEXT)
    const salt = randomBytes(SALT_BYTES)
    const hash = scryptSync(pin, salt, HASH_BYTES)
    this.secrets.set(PIN_SECRET_NAME, `${HASH_FORMAT}$${salt.toString('base64')}$${hash.toString('base64')}`)
  }
}
