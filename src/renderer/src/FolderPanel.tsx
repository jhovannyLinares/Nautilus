import { t } from '@shared/i18n'
import { useEffect, useState, type MouseEvent, type ReactElement } from 'react'
import { buildSubfolders, inSubfolder, prefixesTo, type Subfolder } from '@shared/subfolders'
import type { FolderView, VarView } from '@shared/view'

export const ALL_FOLDERS = 'all'

export type LocationId = 'all' | 'vault' | 'env'

export interface Location {
  id: LocationId
  label: string
  /** Subtítulo de la lista cuando este filtro está elegido. */
  hint: string
  matches: (variable: VarView) => boolean
}

export const LOCATIONS: Location[] = [
  { id: 'all', label: t('Todas'), hint: t('Todas las variables de Nautilus'), matches: () => true },
  {
    id: 'vault',
    label: t('Solo en el Administrador'),
    hint: t('Cifradas, sin copia en el entorno. Claude y tus scripts las leen por su nombre desde el Administrador.'),
    matches: (variable) => !variable.publish
  },
  { id: 'env', label: t('Publicadas en el entorno'), hint: t('También como $env:NAU_… mientras Nautilus está desbloqueada.'), matches: (variable) => variable.publish }
]

export function locationById(id: LocationId): Location {
  return LOCATIONS.find((location) => location.id === id) ?? LOCATIONS[0]!
}

/** Las subcarpetas de una carpeta, armadas con todos sus nombres (el filtro de «Dónde viven» solo cambia los contadores). */
export function subfoldersOf(vars: VarView[], folderId: string): Subfolder[] {
  return buildSubfolders(vars.filter((variable) => variable.folderId === folderId).map((variable) => variable.short))
}

/** Clave de una fila del árbol: la carpeta, o la carpeta y el prefijo de la subcarpeta. */
function nodeKey(folderId: string, prefix: string | null): string {
  return prefix ? `${folderId}:${prefix}` : folderId
}

/**
 * Panel izquierdo: «Dónde viven» (Administrador o entorno), las carpetas en árbol con sus subcarpetas, «+ Nueva
 * carpeta» y cómo se nombra. Los contadores cuentan solo lo que pasa el filtro de «Dónde viven».
 */
export function FolderPanel(props: {
  folders: FolderView[]
  vars: VarView[]
  location: LocationId
  onLocation: (location: LocationId) => void
  selected: string
  selectedSubfolder: string | null
  onSelect: (folderId: string, subfolder: string | null) => void
  onContextMenu: (folder: FolderView, x: number, y: number) => void
  onNewFolder: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // entrar en una subcarpeta desde la lista despliega el camino hasta ella, para que el árbol muestre dónde estás
  useEffect(() => {
    if (props.selected === ALL_FOLDERS || props.selectedSubfolder === null) return
    const folderId = props.selected
    const path = prefixesTo(subfoldersOf(props.vars, folderId), props.selectedSubfolder)
    setExpanded((current) => new Set([...current, folderId, ...path.map((prefix) => nodeKey(folderId, prefix))]))
  }, [props.selected, props.selectedSubfolder])
  const inLocation = props.vars.filter(locationById(props.location).matches)
  const countIn = (folderId: string, prefix: string | null = null) =>
    inLocation.filter((variable) => {
      if (folderId === ALL_FOLDERS) return true
      if (variable.folderId !== folderId) return false
      return prefix === null || inSubfolder(variable.short, prefix)
    }).length
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const select = (folderId: string, prefix: string | null, hasChildren: boolean) => {
    props.onSelect(folderId, prefix)
    if (hasChildren) setExpanded((current) => new Set(current).add(nodeKey(folderId, prefix)))
  }
  const all: FolderView = { id: ALL_FOLDERS, name: t('Todas'), code: '', color: 'rgb(var(--ink) / 0.4)', count: 0 }

  function subfolderRows(folder: FolderView, subfolders: Subfolder[], depth: number): ReactElement[] {
    return subfolders.flatMap((subfolder) => {
      const key = nodeKey(folder.id, subfolder.prefix)
      const isOpen = expanded.has(key)
      const isSelected = props.selected === folder.id && props.selectedSubfolder === subfolder.prefix
      return [
        <TreeRow
          key={key}
          depth={depth}
          label={subfolder.label}
          count={countIn(folder.id, subfolder.prefix)}
          color={folder.color}
          isSubfolder
          isSelected={isSelected}
          isOpen={isOpen}
          hasChildren={subfolder.children.length > 0}
          onToggle={() => toggle(key)}
          onSelect={() => select(folder.id, subfolder.prefix, subfolder.children.length > 0)}
        />,
        ...(isOpen ? subfolderRows(folder, subfolder.children, depth + 1) : [])
      ]
    })
  }
  return (
    <aside className="folders">
      <div className="section-label">{t('DÓNDE VIVEN')}</div>
      {LOCATIONS.map((location) => (
        <button key={location.id} className={'folder' + (props.location === location.id ? ' on' : '')} onClick={() => props.onLocation(location.id)}>
          <span className={'where-dot ' + location.id} />
          <span className="folder-name">{location.label}</span>
          <span className="folder-count">{props.vars.filter(location.matches).length}</span>
        </button>
      ))}
      <div className="folders-divider" />
      <div className="section-label">{t('CARPETAS')}</div>
      {[all, ...props.folders].flatMap((folder) => {
        const subfolders = folder.id === ALL_FOLDERS ? [] : subfoldersOf(props.vars, folder.id)
        const isOpen = expanded.has(folder.id)
        return [
          <TreeRow
            key={folder.id}
            depth={0}
            label={folder.name}
            code={folder.id === ALL_FOLDERS ? '' : folder.code || '—'}
            count={countIn(folder.id)}
            color={folder.color}
            isSubfolder={false}
            isSelected={props.selected === folder.id && props.selectedSubfolder === null}
            isOpen={isOpen}
            hasChildren={subfolders.length > 0}
            onToggle={() => toggle(folder.id)}
            onSelect={() => select(folder.id, null, subfolders.length > 0)}
            onContextMenu={
              folder.id === ALL_FOLDERS
                ? undefined
                : (event) => {
                    event.preventDefault()
                    props.onContextMenu(folder, event.clientX, event.clientY)
                  }
            }
          />,
          ...(isOpen ? subfolderRows(folder, subfolders, 1) : [])
        ]
      })}
      <button className="link new-folder" onClick={props.onNewFolder}>
        {t('+ Nueva carpeta')}
      </button>
      <div className="naming">
        <div className="naming-title">{t('Cómo se nombra')}</div>
        <span className="mono strong">NAU_</span>{' '}{t('+ código de la carpeta + nombre. Cualquier programa la lee por su nombre:')}{' '}
        <span className="mono link-color">$env:NAU_UY_INSIS_PASS</span>.
      </div>
    </aside>
  )
}

/** Una fila del árbol: la flecha despliega o pliega; el resto de la fila elige la carpeta o subcarpeta. */
function TreeRow(props: {
  depth: number
  label: string
  code?: string
  count: number
  color: string
  isSubfolder: boolean
  isSelected: boolean
  isOpen: boolean
  hasChildren: boolean
  onToggle: () => void
  onSelect: () => void
  onContextMenu?: (event: MouseEvent) => void
}) {
  const action = props.isOpen ? t('Plegar') : t('Desplegar')
  return (
    <div className={'folder tree-row' + (props.isSelected ? ' on' : '')} style={{ paddingLeft: 4 + props.depth * 14 }} onContextMenu={props.onContextMenu}>
      {props.hasChildren ? (
        <button className="tree-arrow" aria-label={`${action} ${props.label}`} aria-expanded={props.isOpen} onClick={props.onToggle}>
          {props.isOpen ? '▾' : '▸'}
        </button>
      ) : (
        <span className="tree-arrow" />
      )}
      <button className="tree-pick" onClick={props.onSelect}>
        <span className={props.isSubfolder ? 'subfolder-mark' : 'dot'} style={props.isSubfolder ? { borderColor: props.color } : { background: props.color }} />
        <span className={'folder-name' + (props.isSubfolder ? ' mono subfolder-name' : '')}>{props.label}</span>
        {props.code !== undefined && <span className="folder-code mono">{props.code}</span>}
        <span className="folder-count">{props.count}</span>
      </button>
    </div>
  )
}
