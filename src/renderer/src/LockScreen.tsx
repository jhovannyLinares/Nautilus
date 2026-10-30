import { t } from '@shared/i18n'
import { useState } from 'react'
import { isValidPin, newPinError, PIN_DIGITS } from '@shared/names'
import logo from '../../../resources/logo.png'
import { call, errorText } from './api'
import { FORGOT_INTRO_TEXT, ForgotPinWarning, NEW_PIN_INTRO_TEXT, NewPinFields } from './pin-ui'
import { PinInput } from './ui'

type Mode = 'create' | 'locked' | 'forgot-warning' | 'forgot-new-pin'

const HEADLINE: Record<Mode, string> = {
  create: t('Crea tu PIN de Nautilus'),
  locked: t('Nautilus está bloqueada'),
  'forgot-warning': t('Olvidé mi PIN'),
  'forgot-new-pin': t('Olvidé mi PIN')
}

const BUTTON: Record<Mode, string> = {
  create: t('Crear PIN'),
  locked: t('Desbloquear'),
  'forgot-warning': t('Continuar'),
  'forgot-new-pin': t('Guardar PIN')
}

function lockedText(total: number): string {
  return total === 1
    ? t('La variable sigue guardada y cifrada, pero se retiró del entorno: ningún programa nuevo la ve hasta que desbloquees.')
    : t('Las {0} variables siguen guardadas y cifradas, pero se retiraron del entorno: ningún programa nuevo las ve hasta que desbloquees.', { 0: total })
}

/** Pantalla de bloqueo: crear el PIN la primera vez, desbloquear y «Olvidé mi PIN». */
export function LockScreen(props: { hasPin: boolean; total: number; onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>(props.hasPin ? 'locked' : 'create')
  const [pin, setPin] = useState('')
  const [repeated, setRepeated] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const asksNewPin = mode === 'create' || mode === 'forgot-new-pin'

  function goTo(next: Mode) {
    setMode(next)
    setPin('')
    setRepeated('')
    setError(null)
  }

  async function submit() {
    if (busy) return
    if (mode === 'forgot-warning') return goTo('forgot-new-pin')
    const problem = asksNewPin ? newPinError(pin, repeated) : null
    if (problem) return setError(problem)
    if (!asksNewPin && !isValidPin(pin)) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await call('pin:create', { pin })
      else if (mode === 'forgot-new-pin') await call('pin:reset', { pin })
      else await call('vault:unlock', { pin })
      props.onUnlocked()
    } catch (failure) {
      setError(errorText(failure))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const subtitle = {
    create: t('Lo pedirá al abrir Nautilus, al desbloquear y antes de mostrar o copiar un valor.'),
    locked: lockedText(props.total),
    'forgot-warning': FORGOT_INTRO_TEXT,
    'forgot-new-pin': NEW_PIN_INTRO_TEXT
  }[mode]

  return (
    <div className="lock">
      <img src={logo} width={110} height={110} alt="" className="lock-logo" />
      <span className="lock-title">{HEADLINE[mode]}</span>
      <span className="lock-sub">{subtitle}</span>

      {mode === 'forgot-warning' && <ForgotPinWarning />}
      {mode === 'locked' && <PinInput label="PIN" value={pin} onChange={setPin} onSubmit={() => void submit()} onComplete={() => void submit()} error={!!error} autoFocus />}
      {asksNewPin && <NewPinFields key={mode} pin={pin} repeated={repeated} onPin={setPin} onRepeated={setRepeated} onSubmit={() => void submit()} />}

      {error && <span className="lock-error">{error}</span>}

      <button className="btn primary big" onClick={() => void submit()} disabled={busy}>
        {BUTTON[mode]}
      </button>

      {mode === 'locked' && (
        <button className="link" onClick={() => goTo('forgot-warning')}>
          {t('Olvidé mi PIN')}
        </button>
      )}
      {(mode === 'forgot-warning' || mode === 'forgot-new-pin') && (
        <button className="link" onClick={() => goTo('locked')}>
          {t('Cancelar')}
        </button>
      )}
      {mode === 'create' && <span className="lock-hint">{t('De')}{' '}{PIN_DIGITS}{' '}{t('dígitos. Protege la ventana de Nautilus; los valores los cifra Windows con tu usuario.')}</span>}
    </div>
  )
}
