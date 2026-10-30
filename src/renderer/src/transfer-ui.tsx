import { t } from '@shared/i18n'
import { useEffect, useState } from 'react'
import { isValidPin } from '@shared/names'
import { errorText, onAppEvent } from './api'
import { PinInput } from './ui'

/** Lo compartido por Exportar, Importar y Vaciar: el avance de la operación y el PIN dentro del mismo cuadro. */

export interface Progress {
  done: number
  total: number
}

/** El avance que manda main mientras corre una operación larga. */
export function useProgress(): Progress | null {
  const [progress, setProgress] = useState<Progress | null>(null)
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.type === 'progress') setProgress({ done: event.done, total: event.total })
      }),
    []
  )
  return progress
}

/** «Importando 37 de 220…»; sin avance todavía, solo el verbo. */
export function progressText(verb: string, progress: Progress | null): string {
  return progress ? t('{0} {1} de {2}…', { 0: verb, 1: progress.done, 2: progress.total }) : `${verb}…`
}

/**
 * El paso «Confirma con tu PIN» de una operación: guarda el PIN, corre la operación una sola vez y, si falla,
 * muestra el error y vacía el PIN para reintentar.
 */
export function usePinStep(run: (pin: string) => Promise<void>) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy || !isValidPin(pin)) return
    setBusy(true)
    setError(null)
    try {
      await run(pin)
    } catch (failure) {
      setError(errorText(failure))
      setPin('')
      setBusy(false)
    }
  }

  return { pin, setPin, error, busy, submit }
}

export function PinConfirm(props: { purpose: string; step: ReturnType<typeof usePinStep> }) {
  const { step } = props
  return (
    <div className="center-col">
      <span className="strong">{t('Confirma con tu PIN')}</span>
      <span className="center-text">{props.purpose}</span>
      <PinInput label="PIN" value={step.pin} onChange={step.setPin} onSubmit={() => void step.submit()} onComplete={() => void step.submit()} error={!!step.error} autoFocus />
      {step.error && <span className="lock-error">{step.error}</span>}
    </div>
  )
}
