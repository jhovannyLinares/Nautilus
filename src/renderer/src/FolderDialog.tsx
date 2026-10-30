import { t } from '@shared/i18n'
import { useState } from 'react'
import { FOLDER_COLORS, fullName, GENERAL_ID, isValidCode, normalizeCode } from '@shared/names'
import type { FolderView, Snapshot } from '@shared/view'
import { call, errorText } from './api'
import { Dialog, ErrorLine } from './ui'
import { variablesText } from './format'

export type FolderMode = { kind: 'new' } | { kind: 'edit'; folder: FolderView } | { kind: 'delete'; folder: FolderView }

/** Carpeta: nueva, editar (cambiar el código renombra sus variables) y borrar. */
export function FolderDialog(props: { snap: Snapshot; mode: FolderMode; onClose: () => void; onSaved: (folderId: string | null) => void }) {
  const { snap, mode } = props
  const current = mode.kind === 'new' ? null : mode.folder
  const isGeneral = current?.id === GENERAL_ID
  const [name, setName] = useState(current?.name ?? '')
  const [code, setCode] = useState(current?.code ?? '')
  const [color, setColor] = useState(current?.color ?? FOLDER_COLORS[5])
  const [del, setDel] = useState<'move' | 'drop'>('move')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const owner = snap.folders.find((folder) => folder.id !== current?.id && folder.code === code && code !== '')
  const inside = current ? snap.vars.filter((v) => v.folderId === current.id) : []
  const renames = current && code !== current.code && isValidCode(code) ? inside.map((v) => ({ from: v.name, to: fullName(code, v.short) })) : []
  const valid = isGeneral || (name.trim() !== '' && isValidCode(code) && !owner)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (mode.kind === 'new') {
        const r = await call<{ id: string }>('folder:create', { name, code, color })
        props.onSaved(r.id)
      } else if (mode.kind === 'edit') {
        await call('folder:update', { id: mode.folder.id, name, code, color })
        props.onSaved(mode.folder.id)
      } else {
        await call('folder:delete', { id: mode.folder.id, mode: del })
        props.onSaved(null)
      }
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  const title = mode.kind === 'new' ? t('Nueva carpeta') : mode.kind === 'edit' ? t('Editar carpeta') : t('Borrar carpeta')
  const okLabel = mode.kind === 'new' ? t('Crear') : mode.kind === 'edit' ? (renames.length ? t('Guardar y renombrar') : t('Guardar')) : t('Borrar carpeta')

  return (
    <Dialog
      title={title}
      onClose={props.onClose}
      width={500}
      footer={
        <>
          <button className="btn ml-auto" onClick={props.onClose}>
            {t('Cancelar')}
          </button>
          <button className={'btn ' + (mode.kind === 'delete' ? 'danger-solid' : 'primary')} disabled={busy || (mode.kind !== 'delete' && !valid)} onClick={() => void save()}>
            {okLabel}
          </button>
        </>
      }
    >
      {mode.kind === 'delete' ? (
        inside.length === 0 ? (
          <span>{t('La carpeta')}{' '}{mode.folder.name}{' '}{t('está vacía y se borra sin tocar ninguna variable.')}</span>
        ) : (
          <>
            <span className="strong">
              {t('La carpeta {0} tiene {1}', { 0: mode.folder.name, 1: variablesText(inside.length) })}
            </span>
            <span className="muted">{t('Una carpeta solo se borra vacía. Elige qué hacer con sus variables:')}</span>
            {(
              [
                ['move', t('Moverlas a General'), t('Pierden el código: {0} pasa a {1}.', { 0: inside[0]!.name, 1: fullName('', inside[0]!.short) })],
                ['drop', t('Eliminarlas'), t('Se borran del Administrador de credenciales y del entorno.')]
              ] as const
            ).map(([id, label, hint]) => (
              <button key={id} className={'option' + (del === id ? ' on' : '')} onClick={() => setDel(id)}>
                <span className={'radio' + (del === id ? ' on' : '')} />
                <span className="option-text">
                  <span className="strong">{label}</span>
                  <span className="muted small">{hint}</span>
                </span>
              </button>
            ))}
          </>
        )
      ) : (
        <>
          <div className="row">
            <div className="field grow">
              <span className="label">{t('NOMBRE')}</span>
              <input autoFocus value={name} disabled={isGeneral} placeholder={t('Colombia')} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field code-field">
              <span className="label">{t('CÓDIGO')}</span>
              <input className={'mono' + (renames.length ? ' warn-border' : '')} value={code} disabled={isGeneral} placeholder="CO" onChange={(e) => setCode(normalizeCode(e.target.value))} />
            </div>
          </div>
          <span className="hint">
            {isGeneral ? t('General no lleva código y no se borra; solo cambia su color.') : t('El código va dentro del nombre de cada variable: de 2 a 4 letras, sin repetirse entre carpetas.')}
          </span>
          {owner && <ErrorLine text={t('El código {0} ya es de {1}', { 0: code, 1: owner.name })} />}

          <div className="field">
            <span className="label">{t('COLOR')}</span>
            <div className="row">
              {FOLDER_COLORS.map((swatch) => (
                <button key={swatch} className={'swatch' + (swatch === color ? ' on' : '')} style={{ background: swatch }} onClick={() => setColor(swatch)} aria-label={swatch} />
              ))}
            </div>
          </div>

          {!isGeneral && (
            <div className="info-box">
              <span className="muted small">{t('Sus variables se llamarán')}</span>
              <span className="mono link-color strong">{fullName(code || '…', '…')}</span>
            </div>
          )}

          {renames.length > 0 && current && (
            <div className="warn-box">
              <div className="strong">
                {t('Cambiar el código de {0} a {1} renombra sus {2}', { 0: current.code, 1: code, 2: variablesText(renames.length) })}
              </div>
              <div className="renames mono">
                {renames.map((rename) => (
                  <span key={rename.from} className="rename-row">
                    <span>{rename.from}</span>
                    <span>→</span>
                    <span className="strong">{rename.to}</span>
                  </span>
                ))}
              </div>
              <div>{t('Los programas que usen los nombres anteriores dejarán de encontrarlas.')}</div>
            </div>
          )}
        </>
      )}
      <ErrorLine text={error} />
    </Dialog>
  )
}
