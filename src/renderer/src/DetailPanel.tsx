import { t } from '@shared/i18n'
import type { VarView } from '@shared/view'
import { dateText, expiresText, updatedText } from './format'
import { STATE_CLASS } from './VarTable'

/** Cabe en una línea junto a Mostrar y Copiar en el panel de 360 px. */
const HIDDEN_VALUE = '••••••••••••'

/** Panel derecho: nombre, estado, valor (oculto hasta confirmar el PIN), datos y acciones. */
export function DetailPanel(props: {
  variable: VarView | null
  folderName: string
  revealedValue: string | null
  onShow: () => void
  onHide: () => void
  onCopy: () => void
  onCopyName: () => void
  onEdit: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const { variable } = props
  if (!variable) {
    return (
      <aside className="detail">
        <div className="empty">{t('Selecciona una variable para ver su detalle.')}</div>
      </aside>
    )
  }
  const revealed = props.revealedValue !== null
  const valueText = revealed ? props.revealedValue || t('(vacío)') : variable.hasValue ? HIDDEN_VALUE : t('Sin valor')

  return (
    <aside className="detail">
      <div className="detail-head">
        <span className="section-label">{t('DETALLE')}</span>
        <span className="detail-name-row">
          <span className="mono detail-name">{variable.name}</span>
          <button className="btn copy-name" title={t('Copiar nombre (Ctrl+C)')} aria-label={t('Copiar nombre')} onClick={props.onCopyName}>
            ⧉
          </button>
        </span>
        <span>
          <span className={'badge ' + STATE_CLASS[variable.state]}>{t(variable.state)}</span>
        </span>
      </div>
      <div className="field">
        <span className="label accent">{t('Valor')}</span>
        <div className="row">
          <code className="value-box">{valueText}</code>
          <button className="btn" disabled={!variable.hasValue} onClick={revealed ? props.onHide : props.onShow}>
            {revealed ? t('Ocultar') : t('Mostrar')}
          </button>
          <button className="btn" disabled={!variable.hasValue} onClick={props.onCopy}>
            {t('Copiar')}
          </button>
        </div>
        <span className="hint">{t('Mostrar y copiar piden el PIN.')}</span>
      </div>
      <div className="kv">
        <span className="muted">{t('Carpeta')}</span>
        <span>{props.folderName}</span>
        <span className="muted">{t('Dónde')}</span>
        <span className="where-long">{variable.publish ? t('Administrador y publicada como $env:{0}', { 0: variable.name }) : t('Solo en el Administrador de credenciales')}</span>
        <span className="muted">{t('Vence')}</span>
        <span>{variable.expires ? `${dateText(variable.expires)} (${expiresText(variable.expires)})` : '—'}</span>
        <span className="muted">{t('Actualizada')}</span>
        <span>{updatedText(variable.updatedAt)}</span>
        <span className="muted">{t('Usuario')}</span>
        <span className="mono break-all">{variable.user || '—'}</span>
        <span className="muted">URL</span>
        <span className="mono break-all">{variable.url || '—'}</span>
        <span className="muted">{t('Nota')}</span>
        <span className="pre-wrap">{variable.note || '—'}</span>
      </div>
      <div className="detail-actions">
        <button className="btn" onClick={props.onEdit}>
          {t('Editar')}
        </button>
        <button className="btn" onClick={props.onMove}>
          {t('Mover a carpeta')}
        </button>
        <button className="btn danger" onClick={props.onDelete}>
          {t('Eliminar')}
        </button>
      </div>
    </aside>
  )
}
