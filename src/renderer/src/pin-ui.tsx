import { t } from '@shared/i18n'
import { useRef } from 'react'
import { PIN_DIGITS } from '@shared/names'
import { PinInput } from './ui'

/** Textos del flujo «Olvidé mi PIN», compartidos por la pantalla de bloqueo y el diálogo de Mostrar/Copiar. */
export const FORGOT_INTRO_TEXT = t('Vas a crear un PIN nuevo. Ninguna variable se borra.')
export const NEW_PIN_INTRO_TEXT = t('Elige tu PIN nuevo, de {0} dígitos.', { 0: PIN_DIGITS })

export function ForgotPinWarning() {
  return (
    <div className="warn-box">
      {t('Los valores se conservan: los protege tu usuario de Windows, no el PIN. Cualquiera que entre a tu sesión de Windows podría pedir un PIN nuevo, así que bloquea Windows al levantarte (Windows+L).')}
    </div>
  )
}

/**
 * «PIN nuevo» + «Repite el PIN». Completar el primero pasa al segundo; completar el segundo envía.
 * La validación es `newPinError` de @shared/names.
 */
export function NewPinFields(props: { pin: string; repeated: string; onPin: (v: string) => void; onRepeated: (v: string) => void; onSubmit: () => void }) {
  const repeatedRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <PinInput label={t('PIN NUEVO')} value={props.pin} onChange={props.onPin} onSubmit={props.onSubmit} onComplete={() => repeatedRef.current?.focus()} autoFocus />
      <PinInput label={t('REPITE EL PIN')} value={props.repeated} onChange={props.onRepeated} onSubmit={props.onSubmit} onComplete={props.onSubmit} inputRef={repeatedRef} />
    </>
  )
}
