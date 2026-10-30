import { t } from '@shared/i18n'
import { useState, type DragEvent } from 'react'
import type { ImportFileInfo, ImportPreview } from '@shared/view'
import { call, errorText } from './api'
import { PinConfirm, progressText, usePinStep, useProgress } from './transfer-ui'
import { Dialog, ErrorLine } from './ui'
import { foldersText, variablesText } from './format'

type Step = 'file' | 'preview' | 'pin'
type Choice = 'keep' | 'replace'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Importar: elegir el `.nau`, su contraseña, la vista previa con qué conservar o reemplazar, y el PIN. */
export function ImportDialog(props: { onClose: () => void; onDone: (message: string) => void }) {
  const [step, setStep] = useState<Step>('file')
  const [info, setInfo] = useState<ImportFileInfo | null>(null)
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const progress = useProgress()

  const newCount = preview?.rows.filter((row) => row.kind === 'new').length ?? 0
  const differentCount = preview?.rows.filter((row) => row.kind === 'different').length ?? 0
  const replaceNames = Object.keys(choices).filter((name) => choices[name] === 'replace')
  const filePassword = info?.encrypted ? password : null

  const pinStep = usePinStep(async (pin) => {
    const result = await call<{ created: number; replaced: number; interrupted: boolean }>('vault:importApply', {
      path: info!.path,
      password: filePassword,
      replace: replaceNames,
      pin
    })
    const outcome = `${plural(result.created, 'creada', 'creadas')} y ${plural(result.replaced, 'reemplazada', 'reemplazadas')}`
    props.onDone(result.interrupted ? t('Nautilus se bloqueó en medio: {0}. Vuelve a importar el archivo para terminar.', { 0: outcome }) : t('Importadas: {0}.', { 0: outcome }))
  })

  async function inspect(path: string) {
    setError(null)
    try {
      setInfo(await call<ImportFileInfo>('file:inspect', { path }))
      setPassword('')
    } catch (failure) {
      setInfo(null)
      setError(errorText(failure))
    }
  }

  async function chooseFile() {
    try {
      const response = await call<{ path: string | null }>('file:chooseOpen')
      if (response.path) await inspect(response.path)
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  function dropFile(event: DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) void inspect(window.api.pathForFile(file))
  }

  async function showPreview() {
    if (!info) return
    setLoading(true)
    setError(null)
    try {
      const result = await call<ImportPreview>('vault:importPreview', { path: info.path, password: filePassword })
      setPreview(result)
      setChoices(Object.fromEntries(result.rows.filter((row) => row.kind === 'different').map((row) => [row.name, 'keep' as Choice])))
      setStep('preview')
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setLoading(false)
    }
  }

  const close = () => !pinStep.busy && props.onClose()
  const canPreview = !!info && (!info.encrypted || password !== '') && !loading
  const work = newCount + replaceNames.length
  const applyLabel = work === 0 ? t('Nada que importar') : replaceNames.length ? t('Importar {0} y reemplazar {1}', { 0: newCount, 1: replaceNames.length }) : t('Importar {0}', { 0: newCount })

  function footerHint(): string {
    if (pinStep.busy) return progressText(t('Importando'), progress)
    if (loading) return t('Comparando con lo que ya tienes…')
    return step === 'file' ? '' : t('Importar pide el PIN.')
  }

  return (
    <Dialog
      title={t('Importar variables')}
      onClose={close}
      width={580}
      footer={
        <>
          <span className="hint">{footerHint()}</span>
          <button className="btn ml-auto" disabled={pinStep.busy} onClick={close}>
            {t('Cancelar')}
          </button>
          {step === 'file' && (
            <button className="btn primary" disabled={!canPreview} onClick={() => void showPreview()}>
              {t('Ver qué se importa')}
            </button>
          )}
          {step === 'preview' && (
            <button className="btn primary" disabled={work === 0} onClick={() => setStep('pin')}>
              {applyLabel}
            </button>
          )}
          {step === 'pin' && (
            <button className="btn primary" disabled={pinStep.busy} onClick={() => void pinStep.submit()}>
              {t('Confirmar')}
            </button>
          )}
        </>
      }
    >
      {step === 'file' && (
        <>
          <div
            className={'drop-zone' + (dragOver ? ' over' : '')}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={dropFile}
          >
            <span className="muted">{t('Arrastra aquí un archivo .nau exportado por Nautilus')}</span>
            <button className="btn" onClick={() => void chooseFile()}>
              {t('Elegir archivo…')}
            </button>
          </div>
          {info && (
            <div className="info-box kv-box">
              <span className="muted">{t('Archivo')}</span>
              <span className="mono strong">{info.fileName}</span>
              <span className="muted">{t('Contiene')}</span>
              <span>
                {t('{0} en {1}', { 0: variablesText(info.variables), 1: foldersText(info.folders) })} · {info.encrypted ? t('con valores cifrados') : t('sin valores')}
              </span>
              <span className="muted">{t('Exportado')}</span>
              <span>{new Date(info.exportedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
          )}
          {info?.encrypted && (
            <div className="field">
              <span className="label">{t('CONTRASEÑA DEL ARCHIVO')}</span>
              <input
                className="mono"
                type="password"
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canPreview && void showPreview()}
              />
              <span className="hint">{t('La que se eligió al exportarlo.')}</span>
            </div>
          )}
        </>
      )}

      {step === 'preview' && preview && (
        <>
          <div className="row wrap">
            <span className="badge ok">{plural(newCount, t('nueva'), t('nuevas'))}</span>
            <span className="badge warn">{plural(differentCount, t('con otro valor'), t('con otro valor'))}</span>
            <span className="badge muted">{plural(preview.sameCount, t('igual'), t('iguales'))}{' '}{t('· se omiten')}</span>
            {preview.newFolders.length > 0 && <span className="badge new">{plural(preview.newFolders.length, t('carpeta nueva'), t('carpetas nuevas'))}</span>}
          </div>
          {preview.rows.length > 0 && (
            <div className="import-table">
              <div className="import-row head">
                <span>{t('NOMBRE')}</span>
                <span>{t('QUÉ PASA')}</span>
              </div>
              {preview.rows.map((row) => (
                <div key={row.name} className="import-row">
                  <span className="mono strong ellipsis">{row.name}</span>
                  <span className="import-what">
                    <span className={'badge ' + (row.kind === 'new' ? 'ok' : 'warn')}>{row.kind === 'new' ? t('Nueva') : t('Otro valor')}</span>
                    {row.createsFolder && <span className="muted small">{t('Crea la carpeta')}{' '}{row.createsFolder}</span>}
                    {row.kind === 'different' && (
                      <span className="row wrap">
                        {(['keep', 'replace'] as const).map((choice) => (
                          <button key={choice} className={'chip' + (choices[row.name] === choice ? ' on' : '')} onClick={() => setChoices({ ...choices, [row.name]: choice })}>
                            {choice === 'keep' ? t('Conservar la actual') : t('Reemplazar')}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {preview.sameCount > 0 && <span className="muted small">{plural(preview.sameCount, t('variable igual no cambia nada.'), t('variables iguales no cambian nada.'))}</span>}
          <span className="muted small">
            {t('Cada variable conserva dónde vivía al exportarse. Las que reemplazas cambian de valor en el Administrador y, si están publicadas, en el entorno.')}
          </span>
        </>
      )}

      {step === 'pin' && <PinConfirm purpose={t('Para importar {0}.', { 0: variablesText(work) })} step={pinStep} />}
      <ErrorLine text={error} />
    </Dialog>
  )
}
