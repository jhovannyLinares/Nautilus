import { t } from '@shared/i18n'
import { useState } from 'react'
import { isValidPin, newPinError } from '@shared/names'
import type { VarView } from '@shared/view'
import { call, errorText } from './api'
import { FORGOT_INTRO_TEXT, ForgotPinWarning, NEW_PIN_INTRO_TEXT, NewPinFields } from './pin-ui'
import { Dialog, PinInput } from './ui'

type Step = 'pin' | 'forgot-warning' | 'forgot-new-pin'

const BUTTON: Record<Step, string> = { pin: t('Confirmar'), 'forgot-warning': t('Continuar'), 'forgot-new-pin': t('Guardar PIN') }
const INTRO: Record<Step, string> = {
  pin: t('Para mostrar o copiar el valor de esta variable.'),
  'forgot-warning': FORGOT_INTRO_TEXT,
  'forgot-new-pin': NEW_PIN_INTRO_TEXT
}

/** «Confirma con tu PIN» antes de mostrar o copiar, con el camino de «Olvidé mi PIN». */
export function PinDialog(props: { target: VarView; action: 'show' | 'copy'; onClose: () => void; onRevealed: (value: string) => void; onCopied: () => void }) {
  const [step, setStep] = useState<Step>('pin')
  const [pin, setPin] = useState('')
  const [repeated, setRepeated] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function goTo(next: Step) {
    setStep(next)
    setPin('')
    setRepeated('')
    setError(null)
  }

  /** Con el PIN ya confirmado (o recién reemplazado), hace lo que se pidió. */
  async function runAction(confirmedPin: string) {
    if (props.action === 'copy') {
      await call('var:copy', { id: props.target.id, pin: confirmedPin })
      props.onCopied()
    } else {
      const response = await call<{ value: string }>('var:reveal', { id: props.target.id, pin: confirmedPin })
      props.onRevealed(response.value)
    }
  }

  async function confirm() {
    if (busy) return
    if (step === 'forgot-warning') return goTo('forgot-new-pin')
    const problem = step === 'forgot-new-pin' ? newPinError(pin, repeated) : null
    if (problem) return setError(problem)
    if (!isValidPin(pin)) return
    setBusy(true)
    setError(null)
    try {
      if (step === 'forgot-new-pin') await call('pin:reset', { pin })
      await runAction(pin)
    } catch (failure) {
      setError(errorText(failure))
      setPin('')
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={step === 'pin' ? t('Confirma con tu PIN') : t('Olvidé mi PIN')}
      onClose={props.onClose}
      width={440}
      footer={
        <>
          {step === 'pin' && (
            <button className="link" onClick={() => goTo('forgot-warning')}>
              {t('Olvidé mi PIN')}
            </button>
          )}
          <button className="btn ml-auto" onClick={props.onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void confirm()}>
            {BUTTON[step]}
          </button>
        </>
      }
    >
      <div className="center-col">
        {step === 'pin' && <span className="mono strong big-name">{props.target.name}</span>}
        <span className="center-text">{INTRO[step]}</span>
        {step === 'forgot-warning' && <ForgotPinWarning />}
        {step === 'pin' && <PinInput label="PIN" value={pin} onChange={setPin} onSubmit={() => void confirm()} onComplete={() => void confirm()} error={!!error} autoFocus />}
        {step === 'forgot-new-pin' && <NewPinFields pin={pin} repeated={repeated} onPin={setPin} onRepeated={setRepeated} onSubmit={() => void confirm()} />}
        {error && <span className="lock-error">{error}</span>}
        {step === 'pin' && <span className="hint">{t('El portapapeles se borra solo a los 30 s.')}</span>}
      </div>
    </Dialog>
  )
}
