import { t } from '@shared/i18n'
import { useState } from 'react'
import {
  fullName,
  isValidShort,
  MAX_NOTE_CHARS,
  MAX_URL_CHARS,
  MAX_USER_CHARS,
  normalizeShort,
  VALUE_TOO_LONG_TEXT,
  valueTooLong
} from '@shared/names'
import type { FolderView, Snapshot, VarView } from '@shared/view'
import { call, errorText } from './api'
import { PasswordGenerator } from './PasswordGenerator'
import { Dialog, ErrorLine, FolderChips, PinInput } from './ui'

/**
 * Nueva / editar variable. Al editar, el campo arranca vacío = conservar el valor actual; «Mostrar» lo trae de la
 * bóveda (con el PIN si la configuración lo pide), y si no se toca se sigue conservando.
 */
export function VariableDialog(props: {
  snap: Snapshot
  edit: VarView | null
  folderId: string
  pinForValues: boolean
  onClose: () => void
  onSaved: (id: string) => void
  onDelete: (v: VarView) => void
}) {
  const { snap, edit } = props
  const [folderId, setFolderId] = useState(edit?.folderId ?? props.folderId)
  const [short, setShort] = useState(edit?.short ?? '')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  // el valor guardado, una vez traído con «Mostrar»: si el campo sigue igual, al guardar se conserva
  const [savedValue, setSavedValue] = useState<string | null>(null)
  const [askingPin, setAskingPin] = useState(false)
  const [pin, setPin] = useState('')
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [valueGenerated, setValueGenerated] = useState(false)
  const [hasExp, setHasExp] = useState(!!edit?.expires)
  const [expires, setExpires] = useState(edit?.expires ?? '')
  // una variable nueva arranca solo en el Administrador: publicarla es una decisión, porque el entorno es texto plano
  const [publish, setPublish] = useState(edit?.publish ?? false)
  const [user, setUser] = useState(edit?.user ?? '')
  const [url, setUrl] = useState(edit?.url ?? '')
  const [note, setNote] = useState(edit?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const folder = snap.folders.find((candidate) => candidate.id === folderId) as FolderView
  const name = fullName(folder.code, short)
  const prefix = fullName(folder.code, '')
  const taken = snap.vars.some((v) => v.id !== edit?.id && v.name === name)
  const renamed = !!edit && edit.name !== name
  const tooLong = valueTooLong(value)
  const canSave = isValidShort(short) && !taken && !tooLong && (!hasExp || /^\d{4}-\d{2}-\d{2}$/.test(expires)) && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    const payload = { folderId, short, expires: hasExp ? expires : null, publish, user, url, note }
    try {
      if (edit) {
        const keepsValue = value === '' || value === savedValue
        await call('var:update', { ...payload, id: edit.id, value: keepsValue ? null : value })
        props.onSaved(edit.id)
      } else {
        const r = await call<{ id: string }>('var:create', { ...payload, value })
        props.onSaved(r.id)
      }
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  /** Al editar, el campo vacío no tiene qué mostrar: hay que traer el valor guardado. */
  function toggleShow() {
    const needsSavedValue = !showValue && !!edit?.hasValue && value === ''
    if (!needsSavedValue) return setShowValue(!showValue)
    if (props.pinForValues) return setAskingPin(true)
    void loadSavedValue(null)
  }

  async function loadSavedValue(confirmedPin: string | null) {
    setError(null)
    try {
      const response = await call<{ value: string }>('var:reveal', { id: edit!.id, pin: confirmedPin })
      setValue(response.value)
      setSavedValue(response.value)
      setShowValue(true)
      setAskingPin(false)
    } catch (failure) {
      setError(errorText(failure))
    }
    setPin('')
  }

  async function paste() {
    const r = await call<{ text: string }>('app:paste')
    typeValue(r.text)
  }

  function typeValue(text: string) {
    setValue(text)
    setValueGenerated(false)
  }

  /** La contraseña queda visible para revisarla antes de guardar. */
  function applyGenerated(password: string) {
    setValue(password)
    setValueGenerated(true)
    setShowValue(true)
    setGeneratorOpen(false)
  }

  function valueHint() {
    if (valueGenerated && edit) return <span className="hint warn-text">{t('Contraseña nueva: reemplaza el valor actual al guardar.')}</span>
    if (valueGenerated) return <span className="hint">{t('Contraseña generada: revísala antes de guardar.')}</span>
    if (savedValue !== null && value === savedValue) return <span className="hint">{t('Es el valor guardado. Si lo cambias, se reemplaza al guardar; si no, se conserva.')}</span>
    return <span className="hint">{edit ? t('Déjalo así para conservar el valor actual.') : t('Se guarda cifrado en el Administrador de credenciales de Windows.')}</span>
  }

  return (
    <Dialog
      title={edit ? t('Editar variable') : t('Nueva variable')}
      onClose={props.onClose}
      width={560}
      footer={
        <>
          {edit && (
            <button className="btn danger" onClick={() => props.onDelete(edit)}>
              {t('Eliminar')}
            </button>
          )}
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
        <span className="label">{t('CARPETA')}</span>
        <FolderChips folders={snap.folders} selected={folderId} onSelect={setFolderId} />
      </div>

      <div className="field">
        <span className="label">{t('NOMBRE')}</span>
        <div className="prefixed">
          <span className="prefix">{prefix}</span>
          <input autoFocus className="mono" value={short} placeholder="INSIS_PASS" onChange={(e) => setShort(normalizeShort(e.target.value))} />
        </div>
        <span className="hint">{t('Solo mayúsculas, números y _. Se convierte solo mientras escribes.')}</span>
      </div>

      <div className="field">
        <span className="label">{t('DÓNDE VIVE')}</span>
        <label className="check">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          {t('Publicar también como variable de entorno')}
        </label>
        <div className="info-box column where-box">
          <span className="muted small">{publish ? t('Se publica como') : t('Queda solo en el Administrador de credenciales como')}</span>
          <span className="mono link-color strong">{publish ? `$env:${name}` : name}</span>
          <span className="muted small">
            {publish
              ? t('Mientras Nautilus está desbloqueada, cualquier programa la lee del entorno; ahí vive en texto plano.')
              : t('Sin copia en el entorno. Claude y tus scripts la leen del Administrador por su nombre, dentro del comando.')}
          </span>
        </div>
      </div>
      {taken && <ErrorLine text={t('Ya existe {0}', { 0: name })} />}
      {renamed && edit && (
        <div className="warn-box">
          {t('Cambiaste el nombre: los programas que usaban')}{' '}<span className="mono">{edit.name}</span>{' '}{t('dejarán de encontrarla.')}
        </div>
      )}

      <div className="field">
        <span className="label">{t('VALOR')}</span>
        <div className="row">
          <input
            className="mono grow"
            type={showValue ? 'text' : 'password'}
            autoComplete="off"
            value={value}
            placeholder={edit ? (edit.hasValue ? '••••••••••••' : t('Sin valor')) : t('Pega o escribe el valor')}
            onChange={(e) => typeValue(e.target.value)}
          />
          <button className="btn" onClick={toggleShow}>
            {showValue ? t('Ocultar') : t('Mostrar')}
          </button>
          <button className="btn" onClick={() => void paste()}>
            {t('Pegar')}
          </button>
          <button className={'btn' + (generatorOpen ? ' on' : '')} aria-expanded={generatorOpen} onClick={() => setGeneratorOpen(!generatorOpen)}>
            {t('Generar')}
          </button>
        </div>
        {askingPin && (
          <div className="info-box pin-strip">
            <PinInput label={t('PIN PARA VER EL VALOR GUARDADO')} value={pin} onChange={setPin} onSubmit={() => void loadSavedValue(pin)} onComplete={() => void loadSavedValue(pin)} autoFocus />
            <button className="btn" onClick={() => setAskingPin(false)}>
              {t('Cancelar')}
            </button>
          </div>
        )}
        {valueHint()}
        {tooLong && <ErrorLine text={VALUE_TOO_LONG_TEXT} />}
        {generatorOpen && <PasswordGenerator replacesValue={!!edit?.hasValue} onUse={applyGenerated} />}
      </div>

      <div className="field">
        <span className="label">{t('VENCE')}</span>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={hasExp} onChange={(e) => setHasExp(e.target.checked)} />
            {t('Tiene fecha de vencimiento')}
          </label>
          {hasExp && <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />}
        </div>
        {hasExp && <span className="hint">{t('Nautilus la marca "Vence pronto" 15 días antes y "Vencida" al pasar la fecha.')}</span>}
      </div>

      <div className="field account-section">
        <span className="label">
          {t('DATOS DE LA CUENTA')}{' '}<span className="muted">{t('(opcionales)')}</span>
        </span>
        <div className="row wrap">
          <label className="field grow">
            <span className="hint">{t('Usuario')}</span>
            <input className="mono" value={user} maxLength={MAX_USER_CHARS} placeholder="INSIS_GEN_V10" onChange={(event) => setUser(event.target.value)} />
          </label>
          <label className="field grow-2">
            <span className="hint">URL</span>
            <input className="mono" value={url} maxLength={MAX_URL_CHARS} placeholder="https://… o jdbc:oracle:thin:@…" onChange={(event) => setUrl(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="hint">{t('Nota')}</span>
          <textarea rows={3} value={note} maxLength={MAX_NOTE_CHARS} placeholder={t('Para qué sirve, quién la rota, de qué ambiente es…')} onChange={(event) => setNote(event.target.value)} />
        </label>
        <span className="hint warn-text">{t('Usuario, URL y nota no se cifran: se ven sin PIN y los lee Claude. No escribas aquí contraseñas ni tokens.')}</span>
      </div>
      <ErrorLine text={error} />
    </Dialog>
  )
}
