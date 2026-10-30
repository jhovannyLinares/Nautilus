import { t } from '@shared/i18n'
import { useEffect, useState } from 'react'
import { MIN_FILE_PASSWORD_CHARS } from '@shared/names'
import { generatePassword, strengthOfTyped } from '@shared/password'
import { exportExtension, type ExportFormat, type Snapshot } from '@shared/view'
import { call, errorText } from './api'
import { DEFAULT_OPTIONS } from './PasswordGenerator'
import { PinConfirm, progressText, usePinStep, useProgress } from './transfer-ui'
import { Dialog, ErrorLine, StrengthBar } from './ui'
import { variablesText } from './format'

const FORMAT_OPTIONS: { id: ExportFormat; label: string; hint: string }[] = [
  {
    id: 'encrypted',
    label: t('Con valores, cifrados con una contraseña'),
    hint: t('Para llevarlas a otro equipo o guardar un respaldo. El archivo solo se abre con la contraseña que elijas aquí.')
  },
  {
    id: 'plain',
    label: t('Con valores, en texto plano (.env)'),
    hint: t('Una línea NAU_…=valor por variable, agrupadas por carpeta. Lo lee cualquier programa, y cualquier persona.')
  },
  { id: 'names', label: t('Solo nombres, sin valores'), hint: t('Carpetas, nombres, dónde vive y vencimiento. Sirve de plantilla: al importarlas llegan Vacías.') }
]

const PLAIN_SAMPLE = '# General\nNAU_AZDO_PAT=••••••••\n\n# Uruguay (UY)\nNAU_UY_DEV_INSIS_AMX=••••••••\n…'

function withExtension(path: string, extension: string): string {
  return path.replace(/\.(nau|env)$/i, '') + extension
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** El aviso sobre la contraseña del archivo. Solo habla de lo que ya se escribió: un campo vacío no es un error. */
function passwordMessage(password: string, repeated: string): string | null {
  if (password && password.length < MIN_FILE_PASSWORD_CHARS) return t('La contraseña necesita al menos {0} caracteres.', { 0: MIN_FILE_PASSWORD_CHARS })
  if (repeated && password !== repeated) return t('Las dos contraseñas no coinciden.')
  return null
}

/** Exportar: carpetas, formato, contraseña del archivo y destino; después el PIN. */
export function ExportDialog(props: { snap: Snapshot; onClose: () => void; onDone: (message: string) => void }) {
  const { snap } = props
  const [picked, setPicked] = useState<string[]>(snap.folders.map((folder) => folder.id))
  const [format, setFormat] = useState<ExportFormat>('encrypted')
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [path, setPath] = useState<string | null>(null)
  const [askingPin, setAskingPin] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const progress = useProgress()

  // la carpeta Documentos la conoce main
  useEffect(() => {
    call<{ path: string }>('file:defaultExportPath', { format: 'encrypted' })
      .then((response) => setPath(response.path))
      .catch((failure) => setError(errorText(failure)))
  }, [])

  const count = snap.folders.filter((folder) => picked.includes(folder.id)).reduce((sum, folder) => sum + folder.count, 0)
  const passwordReady = password.length >= MIN_FILE_PASSWORD_CHARS && password === repeated
  const canExport = count > 0 && (format !== 'encrypted' || passwordReady) && path !== null

  const pinStep = usePinStep(async (pin) => {
    const response = await call<{ path: string; count: number }>('vault:export', {
      folderIds: picked,
      format,
      password: format === 'encrypted' ? password : null,
      pin,
      path
    })
    props.onDone(t('Exportadas {0} variables a {1}.', { 0: response.count, 1: fileNameOf(response.path) }))
  })

  function toggleFolder(folderId: string) {
    setPicked(picked.includes(folderId) ? picked.filter((id) => id !== folderId) : [...picked, folderId])
  }

  function chooseFormat(next: ExportFormat) {
    setFormat(next)
    setPath((current) => current && withExtension(current, exportExtension(next)))
  }

  function generate() {
    const generated = generatePassword(DEFAULT_OPTIONS)
    setPassword(generated)
    setRepeated(generated)
    setShowPassword(true)
  }

  async function changePath() {
    if (!path) return
    try {
      const response = await call<{ path: string | null }>('file:chooseSave', { format, current: path })
      if (response.path) setPath(withExtension(response.path, exportExtension(format)))
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  const close = () => !pinStep.busy && props.onClose()
  const purpose = format === 'names' ? t('Para exportar los nombres de {0} variables.', { 0: count }) : t('Para exportar {0} variables con sus valores.', { 0: count })

  return (
    <Dialog
      title={t('Exportar variables')}
      onClose={close}
      width={580}
      footer={
        <>
          <span className="hint">{pinStep.busy ? progressText(t('Exportando'), progress) : t('Exportar pide el PIN.')}</span>
          <button className="btn ml-auto" disabled={pinStep.busy} onClick={close}>
            {t('Cancelar')}
          </button>
          {askingPin ? (
            <button className="btn primary" disabled={pinStep.busy} onClick={() => void pinStep.submit()}>
              {t('Confirmar')}
            </button>
          ) : (
            <button className="btn primary" disabled={!canExport} onClick={() => setAskingPin(true)}>
              {t('Exportar {0}', { 0: variablesText(count) })}
            </button>
          )}
        </>
      }
    >
      {askingPin ? (
        <PinConfirm purpose={purpose} step={pinStep} />
      ) : (
        <>
          <div className="field">
            <span className="label">{t('QUÉ CARPETAS')}</span>
            <div className="folder-checks">
              {snap.folders.map((folder) => (
                <label key={folder.id} className={'check folder-check' + (picked.includes(folder.id) ? ' on' : '')}>
                  <input type="checkbox" checked={picked.includes(folder.id)} onChange={() => toggleFolder(folder.id)} />
                  <span className="dot" style={{ background: folder.color }} />
                  <span className="grow">{folder.name}</span>
                  <span className="muted">{folder.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">{t('VALORES')}</span>
            {FORMAT_OPTIONS.map((option) => (
              <button key={option.id} className={'option' + (format === option.id ? ' on' : '')} onClick={() => chooseFormat(option.id)}>
                <span className={'radio' + (format === option.id ? ' on' : '')} />
                <span className="option-text">
                  <span className="strong">{option.label}</span>
                  <span className="muted small">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {format === 'encrypted' && (
            <div className="field">
              <div className="row">
                <div className="field grow">
                  <span className="label">{t('CONTRASEÑA DEL ARCHIVO')}</span>
                  <input className="mono" type={showPassword ? 'text' : 'password'} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="field grow">
                  <span className="label">{t('REPÍTELA')}</span>
                  <input className="mono" type={showPassword ? 'text' : 'password'} autoComplete="off" value={repeated} onChange={(e) => setRepeated(e.target.value)} />
                </div>
              </div>
              <div className="row">
                <StrengthBar strength={strengthOfTyped(password)} />
                <button className="btn ml-auto" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? t('Ocultar') : t('Mostrar')}
                </button>
                <button className="btn" onClick={generate}>
                  {t('Generar')}
                </button>
              </div>
              <ErrorLine text={passwordMessage(password, repeated)} />
              <div className="warn-box">{t('Nautilus no guarda esta contraseña. Si la olvidas, el archivo no se puede abrir: ni Nautilus ni nadie recupera los valores.')}</div>
            </div>
          )}

          {format === 'plain' && (
            <div className="danger-box">
              <span className="strong danger-text">{t('Los valores quedan a la vista')}</span>
              <span>{t('Cualquiera que abra el archivo ve todas las contraseñas y tokens. Úsalo y bórralo; no lo guardes en una carpeta sincronizada ni lo envíes por correo.')}</span>
              <pre className="plain-sample">{PLAIN_SAMPLE}</pre>
            </div>
          )}

          <div className="field">
            <span className="label">{t('ARCHIVO')}</span>
            <div className="row">
              <input className="mono grow" readOnly value={path ?? ''} aria-label={t('Archivo')} />
              <button className="btn" disabled={!path} onClick={() => void changePath()}>
                {t('Cambiar…')}
              </button>
            </div>
          </div>
        </>
      )}
      <ErrorLine text={error} />
    </Dialog>
  )
}
