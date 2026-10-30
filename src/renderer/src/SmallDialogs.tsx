import { t } from '@shared/i18n'
import { useState } from 'react'
import { AUTO_LOCK_OPTIONS, fullName, isValidPin } from '@shared/names'
import type { AppStatus, ClaudeState, Snapshot, VarView } from '@shared/view'
import { call, errorText } from './api'
import { Dialog, ErrorLine, FolderChips, PinInput } from './ui'

/** Herramientas › Configuración: PIN para mostrar y copiar, bloqueo automático e integración con Claude Code. */
export function SettingsDialog(props: { status: AppStatus; onClose: () => void; onSaved: () => void }) {
  const { status } = props
  const [pinForValues, setPinForValues] = useState(status.pinForValues)
  const [pin, setPin] = useState('')
  const [autoLockMin, setAutoLockMin] = useState(status.autoLockMin)
  const [claudeEnabled, setClaudeEnabled] = useState(status.claude !== 'off')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // apagar el PIN para mostrar y copiar es lo único que pide confirmarlo
  const turningPinOff = status.pinForValues && !pinForValues
  const canSave = !busy && (!turningPinOff || isValidPin(pin))

  /** Solo se guarda lo que cambió: cada opción tiene su canal y sus efectos (Claude escribe archivos). */
  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      if (pinForValues !== status.pinForValues) await call('settings:pinForValues', { enabled: pinForValues, pin: turningPinOff ? pin : null })
      if (autoLockMin !== status.autoLockMin) await call('settings:autoLock', { min: autoLockMin })
      if (claudeEnabled !== (status.claude !== 'off')) await call('settings:claudeSkill', { enabled: claudeEnabled })
      props.onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setPin('')
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('Configuración')}
      onClose={props.onClose}
      width={560}
      footer={
        <>
          <span className="hint">{t('Herramientas › Configuración… · Ctrl+,')}</span>
          <button className="btn ml-auto" onClick={props.onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn primary" disabled={!canSave} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="label">{t('SEGURIDAD')}</span>
        <label className="check strong">
          <input type="checkbox" checked={pinForValues} onChange={(event) => setPinForValues(event.target.checked)} />{' '}{t('Pedir el PIN para mostrar o copiar un valor')}
        </label>
        <span className="hint">
          {pinForValues
            ? t('Además del desbloqueo, Nautilus pide el PIN cada vez que muestras o copias un valor: en el detalle y al editar una variable.')
            : t('El PIN de desbloqueo es el único: mostrar y copiar funcionan sin pedirlo.')}
        </span>
        {!pinForValues && (
          <div className="warn-box">
            {t('Sin esta opción, el PIN solo se pide al desbloquear. Mientras Nautilus esté desbloqueada, quien esté frente a tu equipo puede ver y copiar cualquier valor. El bloqueo automático y Windows+L siguen protegiéndolos.')}
          </div>
        )}
        {turningPinOff && <PinInput label={t('PARA APAGARLA, CONFIRMA TU PIN')} value={pin} onChange={setPin} onSubmit={() => void save()} error={!!error} autoFocus />}
      </div>

      <div className="field settings-section">
        <span className="label">{t('BLOQUEO AUTOMÁTICO')}</span>
        <span>{t('Bloquear Nautilus tras este tiempo sin usarla:')}</span>
        <div className="row wrap">
          {AUTO_LOCK_OPTIONS.map((minutes) => (
            <button key={minutes} className={'chip' + (minutes === autoLockMin ? ' on' : '')} onClick={() => setAutoLockMin(minutes)}>
              {minutes} min
            </button>
          ))}
        </div>
        <span className="hint">{t('También al bloquear la sesión de Windows y al cerrar Nautilus: esas dos no se pueden apagar.')}</span>
      </div>

      <div className="field settings-section">
        <span className="label">{t('CLAUDE CODE')}</span>
        <ClaudeSection current={status.claude} enabled={claudeEnabled} onChange={setClaudeEnabled} />
      </div>
      <ErrorLine text={error} />
    </Dialog>
  )
}

const CLAUDE_SKILL_PATH = '%USERPROFILE%\\.claude\\skills\\nautilus\\SKILL.md'

/** Instala o quita el skill que le enseña a Claude a usar Nautilus. */
function ClaudeSection(props: { current: ClaudeState; enabled: boolean; onChange: (enabled: boolean) => void }) {
  const { enabled } = props
  const wasEnabled = props.current !== 'off'
  return (
    <>
      <label className="check strong">
        <input type="checkbox" checked={enabled} onChange={(e) => props.onChange(e.target.checked)} />{' '}{t('Enseñarle a Claude Code a usar Nautilus')}
      </label>
      <span>
        {t('Claude conoce los nombres de tus variables, nunca sus valores. Cuando le pidas algo que necesita una contraseña, te pregunta cuál usar; si no existe, te pide que la crees aquí.')}
      </span>
      {enabled && props.current === 'noclaude' && (
        <div className="info-box column">
          <span>{t('Claude Code todavía no está instalado en esta PC. Queda listo en')}</span>
          <span className="mono link-color small">{CLAUDE_SKILL_PATH}</span>
          <span>{t('y Claude lo toma en cuanto lo instales.')}</span>
        </div>
      )}
      {enabled && props.current !== 'noclaude' && (
        <>
          <div className="info-box column">
            <span className="muted small">{wasEnabled ? t('Instalado en') : t('Se instala en')}</span>
            <span className="mono link-color small">{CLAUDE_SKILL_PATH}</span>
          </div>
          <span className="hint">{t('Lo ven las sesiones de Claude que abras después de encenderlo. Al actualizar Nautilus se actualiza solo.')}</span>
        </>
      )}
      {!enabled && (
        <div className="warn-box">
          {t('Al guardar se borra el skill de')}{' '}<span className="mono">%USERPROFILE%\.claude\skills\nautilus\</span>{t('. Claude deja de pedirte las claves por su nombre. Tus variables se siguen publicando y los programas que ya las usan siguen funcionando.')}
        </div>
      )}
      <span className="hint">{t('Desinstalar Nautilus también lo borra.')}</span>
    </>
  )
}

/** Ayuda › Acerca de Nautilus. */
export function AboutDialog(props: { version: string; onClose: () => void }) {
  return (
    <Dialog
      title={t('Acerca de Nautilus')}
      onClose={props.onClose}
      width={440}
      footer={
        <button className="btn primary ml-auto" onClick={props.onClose}>
          {t('Cerrar')}
        </button>
      }
    >
      <span className="strong">Nautilus {props.version}</span>
      <span>{t('Guarda tus secretos cifrados en el Administrador de credenciales de Windows y los publica como variables de entorno mientras está desbloqueada.')}</span>
    </Dialog>
  )
}

export function ConfirmDeleteDialog(props: { target: VarView; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  async function del() {
    try {
      await call('var:delete', { id: props.target.id })
      props.onDeleted()
    } catch (failure) {
      setError(errorText(failure))
    }
  }
  return (
    <Dialog
      title={t('Eliminar variable')}
      onClose={props.onClose}
      width={460}
      footer={
        <>
          <button className="btn ml-auto" onClick={props.onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn danger-solid" onClick={() => void del()}>
            {t('Eliminar')}
          </button>
        </>
      }
    >
      <span>
        {t('Se borra')}{' '}<span className="mono strong">{props.target.name}</span>{' '}{t('del Administrador de credenciales y se retira del entorno. No se puede deshacer.')}
      </span>
      <ErrorLine text={error} />
    </Dialog>
  )
}

export function MoveDialog(props: { snap: Snapshot; target: VarView; onClose: () => void; onMoved: () => void }) {
  const [folderId, setFolderId] = useState(props.target.folderId)
  const [error, setError] = useState<string | null>(null)
  const folder = props.snap.folders.find((candidate) => candidate.id === folderId)!
  const name = fullName(folder.code, props.target.short)
  const taken = props.snap.vars.some((variable) => variable.id !== props.target.id && variable.name === name)
  async function move() {
    try {
      await call('var:update', { id: props.target.id, folderId, short: props.target.short, value: null, expires: props.target.expires, publish: props.target.publish })
      props.onMoved()
    } catch (failure) {
      setError(errorText(failure))
    }
  }
  return (
    <Dialog
      title={t('Mover a carpeta')}
      onClose={props.onClose}
      width={500}
      footer={
        <>
          <button className="btn ml-auto" onClick={props.onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn primary" disabled={taken || folderId === props.target.folderId} onClick={() => void move()}>
            {t('Mover')}
          </button>
        </>
      }
    >
      <FolderChips folders={props.snap.folders} selected={folderId} onSelect={setFolderId} />
      <div className="info-box">
        <span className="muted small">{t('Pasa a llamarse')}</span>
        <span className="mono link-color strong">$env:{name}</span>
      </div>
      {taken && <ErrorLine text={t('Ya existe {0}', { 0: name })} />}
      {folderId !== props.target.folderId && !taken && (
        <div className="warn-box">
          {t('Los programas que usaban')}{' '}<span className="mono">{props.target.name}</span>{' '}{t('dejarán de encontrarla.')}
        </div>
      )}
      <ErrorLine text={error} />
    </Dialog>
  )
}

export function HelpDialog(props: { onClose: () => void }) {
  return (
    <Dialog
      title={t('Lo que conviene saber')}
      onClose={props.onClose}
      width={560}
      footer={
        <>
          <button className="link" onClick={() => void call('app:openLog')}>
            {t('Abrir el registro')}
          </button>
          <button className="btn primary ml-auto" onClick={props.onClose}>
            {t('Entendido')}
          </button>
        </>
      }
    >
      <ul className="help">
        <li>{t('Un programa que ya estaba abierto no ve una variable publicada después; hay que reiniciarlo.')}</li>
        <li>{t('Bloquear retira las variables del entorno, pero un programa que ya estaba abierto conserva su copia hasta que se cierra.')}</li>
        <li>
          {t('Mientras Nautilus está desbloqueada, las variables de entorno de usuario están en el registro de Windows (')}<span className="mono">HKCU\Environment</span>{t(') en texto plano. Es el costo de que cualquier programa las lea.')}
        </li>
        <li>{t('El PIN protege la ventana de Nautilus. Los valores los cifra Windows con tu cuenta de usuario.')}</li>
        <li>
          {t('Cada variable elige dónde vive. Las que no se publican quedan solo en el Administrador de credenciales (')}
          <span className="mono">nautilus:NAU_…</span>{t(') y un programa las lee de ahí por su nombre. Eso funciona aunque Nautilus esté bloqueada: las protege tu sesión de Windows, no el PIN.')}
        </li>
      </ul>
    </Dialog>
  )
}
