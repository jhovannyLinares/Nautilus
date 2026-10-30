import { t } from '@shared/i18n'
import { useState } from 'react'
import type { VarView } from '@shared/view'
import { expiresText, updatedText } from './format'

export const STATE_CLASS: Record<VarView['state'], string> = { Activa: 'ok', Nueva: 'new', Vacía: 'muted', 'Vence pronto': 'warn', Vencida: 'err' }
/** Solo los estados de vencimiento tiñen la fila; el resto la deja neutra. */
const ROW_CLASS: Partial<Record<VarView['state'], string>> = { 'Vence pronto': ' soon', Vencida: ' expired' }

/** Una subcarpeta del nivel que se está viendo, como fila de la lista. */
export interface FolderRow {
  prefix: string
  label: string
  count: number
}

type SortKey = 'name' | 'state' | 'where' | 'expires' | 'updated'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: t('NOMBRE') },
  { key: 'state', label: t('ESTADO') },
  { key: 'where', label: t('DÓNDE') },
  { key: 'expires', label: t('VENCE') },
  { key: 'updated', label: t('ACTUALIZADA') }
]

/** Sin fecha de vencimiento va al final al ordenar de menor a mayor: no vence nunca. */
const NEVER_EXPIRES = '9999-12-31'

function compareVars(a: VarView, b: VarView, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'state':
      return a.state.localeCompare(b.state)
    case 'where':
      return Number(a.publish) - Number(b.publish)
    case 'expires':
      return (a.expires ?? NEVER_EXPIRES).localeCompare(b.expires ?? NEVER_EXPIRES)
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt)
  }
}

/**
 * Lista central, como un explorador: arriba las subcarpetas del nivel (doble clic las abre) y después sus variables
 * sueltas. Clic en un encabezado ordena por esa columna; otro clic invierte. Las carpetas quedan siempre arriba.
 */
export function VarTable(props: {
  title: string
  subtitle: string
  folders: FolderRow[]
  vars: VarView[]
  freshCount: number
  emptyText: string
  /** El prefijo del nivel que se está viendo (`NAU_UY_DEV_INSIS_`): se atenúa para que resalte lo que falta. */
  namePrefix: string
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (variable: VarView) => void
  onContextMenu: (variable: VarView, x: number, y: number) => void
  onOpenFolder: (prefix: string) => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false })
  const direction = sort.descending ? -1 : 1
  const sortedVars = [...props.vars].sort((a, b) => direction * compareVars(a, b, sort.key))
  // las carpetas solo se ordenan por nombre; con otra columna quedan alfabéticas
  const folderDirection = sort.key === 'name' ? direction : 1
  const sortedFolders = [...props.folders].sort((a, b) => folderDirection * a.label.localeCompare(b.label))
  const sortBy = (key: SortKey) => setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }))
  const isEmpty = sortedFolders.length === 0 && sortedVars.length === 0

  return (
    <section className="list">
      <div className="list-head">
        <span className="list-title">{props.title}</span>
        <span className="muted">{props.subtitle}</span>
      </div>
      {props.freshCount > 0 && (
        <div className="notice">
          {props.freshCount} {props.freshCount === 1 ? t('variable se publicó') : t('variables se publicaron')}{' '}{t('hace poco: los programas que ya estaban abiertos no las ven hasta reiniciarlos.')}
        </div>
      )}
      <div className="table">
        <div className="tr th">
          {COLUMNS.map((column) => (
            <button
              key={column.key}
              className={'sort-head' + (sort.key === column.key ? ' on' : '')}
              aria-sort={sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
              onClick={() => sortBy(column.key)}
            >
              {column.label}
              {sort.key === column.key && <span className="sort-arrow">{sort.descending ? '▼' : '▲'}</span>}
            </button>
          ))}
        </div>
        {sortedFolders.map((folder) => (
          <button key={'folder:' + folder.prefix} className="tr folder-row" title={t('Doble clic para abrir')} onDoubleClick={() => props.onOpenFolder(folder.prefix)}>
            <span className="folder-row-name ellipsis">
              <span className="folder-icon" aria-hidden="true" />
              <span className="mono strong">{folder.label}</span>
            </span>
            <span className="muted">{folder.count === 1 ? t('1 variable') : t('{0} variables', { 0: folder.count })}</span>
            <span className="muted">{t('Carpeta')}</span>
            <span />
            <span />
          </button>
        ))}
        {sortedVars.map((variable) => (
          <button
            key={variable.id}
            className={'tr' + (ROW_CLASS[variable.state] ?? '') + (variable.id === props.selectedId ? ' on' : '')}
            onClick={() => props.onSelect(variable.id)}
            onDoubleClick={() => props.onOpen(variable)}
            onContextMenu={(event) => {
              event.preventDefault()
              props.onSelect(variable.id)
              props.onContextMenu(variable, event.clientX, event.clientY)
            }}
          >
            <span className="mono strong ellipsis">
              {props.namePrefix && variable.name.startsWith(props.namePrefix) ? (
                <>
                  <span className="name-prefix">{props.namePrefix}</span>
                  {variable.name.slice(props.namePrefix.length)}
                </>
              ) : (
                variable.name
              )}
            </span>
            <span>
              <span className={'badge ' + STATE_CLASS[variable.state]}>{t(variable.state)}</span>
            </span>
            <span className="where">
              <span className={'where-dot ' + (variable.publish ? 'env' : 'vault')} />
              {variable.publish ? t('Entorno') : t('Administrador')}
            </span>
            <span className="expires">{expiresText(variable.expires)}</span>
            <span>{updatedText(variable.updatedAt)}</span>
          </button>
        ))}
        {isEmpty && <div className="empty">{props.emptyText}</div>}
      </div>
    </section>
  )
}
