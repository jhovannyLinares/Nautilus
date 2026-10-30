import { t } from '@shared/i18n'
import { useState } from 'react'
import { GENERAL_ID } from '@shared/names'
import type { Snapshot } from '@shared/view'
import { call } from './api'
import { PinConfirm, progressText, usePinStep, useProgress } from './transfer-ui'
import { Dialog } from './ui'
import { foldersText, variablesText } from './format'

/** Lo que hay que escribir para encender el botón: vaciar no se hace de un clic. */
const CONFIRM_WORD = 'VACIAR'

/** Vaciar la bóveda: qué se borra, qué se conserva, escribir VACIAR y el PIN. */
export function WipeDialog(props: { snap: Snapshot; onClose: () => void; onExportFirst: () => void; onDone: (message: string) => void }) {
  const { snap } = props
  const [typed, setTyped] = useState('')
  const [askingPin, setAskingPin] = useState(false)
  const progress = useProgress()

  const varCount = snap.vars.length
  const folderNames = snap.folders.filter((folder) => folder.id !== GENERAL_ID).map((folder) => folder.name)
  const confirmed = typed === CONFIRM_WORD

  const pinStep = usePinStep(async (pin) => {
    const result = await call<{ deleted: number; interrupted: boolean }>('vault:wipe', { pin })
    props.onDone(
      result.interrupted
        ? t('Nautilus se bloqueó en medio: se borraron {0} de {1} variables. Las demás siguen intactas.', { 0: result.deleted, 1: varCount })
        : t('Bóveda vaciada: {0} variables borradas.', { 0: result.deleted })
    )
  })

  const close = () => !pinStep.busy && props.onClose()

  return (
    <Dialog
      title={t('Vaciar la bóveda')}
      onClose={close}
      width={580}
      footer={
        <>
          <span className="hint">{pinStep.busy ? progressText(t('Borrando'), progress) : t('Vaciar pide el PIN.')}</span>
          <button className="btn ml-auto" disabled={pinStep.busy} onClick={close}>
            {t('Cancelar')}
          </button>
          {askingPin ? (
            <button className="btn danger-solid" disabled={pinStep.busy} onClick={() => void pinStep.submit()}>
              {t('Confirmar')}
            </button>
          ) : (
            <button className="btn danger-solid" disabled={!confirmed || varCount === 0} onClick={() => setAskingPin(true)}>
              {t('Vaciar la bóveda')}
            </button>
          )}
        </>
      }
    >
      {askingPin ? (
        <PinConfirm purpose={t('Para borrar las {0} variables de Nautilus.', { 0: varCount })} step={pinStep} />
      ) : (
        <>
          <div className="danger-box">
            <span className="strong danger-text">
              {folderNames.length ? t('Se borran {0} y {1}', { 0: variablesText(varCount), 1: foldersText(folderNames.length) }) : t('Se borran {0}', { 0: variablesText(varCount) })}
            </span>
            <span>
              {t('Las {0} credenciales', { 0: varCount })} <span className="mono strong">nautilus:NAU_…</span>{' '}{t('del Administrador de credenciales, las')}{' '}{snap.published}{' '}{t('variables publicadas en el entorno')}{folderNames.length ? t(' y las carpetas {0}', { 0: folderNames.join(', ') }) : ''}.
            </span>
          </div>
          <div className="soft-box">
            <span className="strong">{t('Se conserva')}</span>
            <span>{t('Tu PIN, el bloqueo automático, la integración con Claude Code y la carpeta General, vacía.')}</span>
          </div>
          <div className="warn-box row">
            <span className="grow">{t('No se puede deshacer. Si puedes necesitarlas, expórtalas antes con sus valores.')}</span>
            <button className="btn" onClick={props.onExportFirst}>
              {t('Exportar primero')}
            </button>
          </div>
          <div className="field">
            <span className="label">{t('ESCRIBE {0} PARA CONFIRMAR', { 0: CONFIRM_WORD })}</span>
            <input
              className={'mono' + (confirmed ? ' danger-border' : '')}
              autoComplete="off"
              placeholder={t('Escribe {0}…', { 0: CONFIRM_WORD })}
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              aria-label={t('Escribe {0} para confirmar', { 0: CONFIRM_WORD })}
            />
          </div>
        </>
      )}
    </Dialog>
  )
}
