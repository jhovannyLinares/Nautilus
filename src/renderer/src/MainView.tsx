import { t } from '@shared/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fullName, GENERAL_ID } from '@shared/names'
import type { FolderView, Snapshot, VarView } from '@shared/view'
import { call, errorText } from './api'
import type { CommandRequest, MainCommand, SelectionCommand } from './commands'
import { DetailPanel } from './DetailPanel'
import { ExportDialog } from './ExportDialog'
import { FolderDialog, type FolderMode } from './FolderDialog'
import { ImportDialog } from './ImportDialog'
import { WipeDialog } from './WipeDialog'
import { childrenAt, inSubfolder, isDirectlyIn, pathTo } from '@shared/subfolders'
import { ALL_FOLDERS, FolderPanel, locationById, subfoldersOf, type LocationId } from './FolderPanel'
import { PinDialog } from './PinDialog'
import { ConfirmDeleteDialog, HelpDialog, MoveDialog } from './SmallDialogs'
import { VariableDialog } from './VariableDialog'
import { VarTable, type FolderRow } from './VarTable'

/** El valor mostrado y los avisos se ocultan solos. */
const REVEAL_MS = 30_000
const TOAST_MS = 4_000
const NO_SELECTION_TEXT = t('Elige una variable primero.')

type Modal =
  | { kind: 'var'; edit: VarView | null }
  | { kind: 'folder'; mode: FolderMode }
  | { kind: 'pin'; target: VarView; action: 'show' | 'copy' }
  | { kind: 'delete'; target: VarView }
  | { kind: 'move'; target: VarView }
  | { kind: 'help' }
  | { kind: 'export' }
  | { kind: 'import' }
  | { kind: 'wipe' }
  | null

type ContextMenu =
  | { kind: 'folder'; folder: FolderView; x: number; y: number }
  | { kind: 'var'; variable: VarView; x: number; y: number }

/** Oculta `value` tras `ms`; el temporizador se reinicia cada vez que el valor cambia. */
function useAutoClear<T>(value: T | null, clear: () => void, ms: number): void {
  useEffect(() => {
    if (value === null) return
    const timer = setTimeout(clear, ms)
    return () => clearTimeout(timer)
  }, [value, clear, ms])
}

function folderSubtitle(folder: FolderView | null): string {
  if (!folder) return t('Todas las variables de Nautilus')
  return folder.code ? `NAU_${folder.code}_…` : t('Sin código: NAU_ + nombre. Lo que no es de un cliente.')
}

/** Qué dice la lista vacía: no hubo coincidencias, la carpeta tiene variables pero no viven ahí, o está vacía. */
function emptyListText(list: { searching: boolean; filteredByLocation: boolean; folderHasVars: boolean }): string {
  if (list.searching) return t('Nada coincide con la búsqueda.')
  if (list.filteredByLocation && list.folderHasVars) return t('Ninguna variable de esta carpeta vive ahí.')
  return t('Sin variables todavía. Créalas con + Nueva.')
}

function copiedText(name: string): string {
  return t('{0} copiada. El portapapeles se borra en 30 s.', { 0: name })
}

/** Ventana principal: barra de acciones, carpetas, lista, detalle y los diálogos que abren. */
export function MainView(props: {
  snap: Snapshot
  reload: () => Promise<void>
  pinForValues: boolean
  command: CommandRequest | null
  helpOpen: boolean
  onHelpClose: () => void
}) {
  const { snap, reload } = props
  const [folderId, setFolderId] = useState<string>(ALL_FOLDERS)
  const [subfolder, setSubfolder] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<LocationId>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(snap.vars[0]?.id ?? null)
  const [modal, setModal] = useState<Modal>(null)
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (props.helpOpen) setModal({ kind: 'help' })
  }, [props.helpOpen])
  useAutoClear(revealed, () => setRevealed(null), REVEAL_MS)
  useAutoClear(toast, () => setToast(null), TOAST_MS)
  useEffect(() => {
    if (revealed && revealed.id !== selectedId) setRevealed(null)
  }, [selectedId, revealed])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const folderOf = (id: string) => snap.folders.find((folder) => folder.id === id) ?? null
  const currentFolder = folderId === ALL_FOLDERS ? null : folderOf(folderId)
  const location = locationById(locationId)
  const filteredByLocation = locationId !== 'all'
  const search = query.trim().toUpperCase()
  const folderVars = snap.vars.filter((variable) => {
    if (folderId === ALL_FOLDERS) return true
    if (variable.folderId !== folderId) return false
    return subfolder === null || inSubfolder(variable.short, subfolder)
  })
  const visibleVars = useMemo(
    () =>
      folderVars.filter((variable) => {
        if (!location.matches(variable)) return false
        if (!search) return true
        return variable.name.includes(search) || (folderOf(variable.folderId)?.name.toUpperCase().includes(search) ?? false)
      }),
    [snap, folderId, subfolder, locationId, search]
  )
  /** «Uruguay › DEV › INSIS»: la ruta sale del árbol, así un nivel juntado (`DEV_INSIS`) se lee como uno. */
  const breadcrumb = (folder: FolderView, short: string | null) =>
    [folder.name, ...(short ? pathTo(subfoldersOf(snap.vars, folder.id), short) : [])].join(' › ')
  const folderTitle = currentFolder ? breadcrumb(currentFolder, subfolder) : t('Todas')
  const namePrefix = currentFolder ? fullName(currentFolder.code, subfolder ? subfolder + '_' : '') : ''
  // Como un explorador: dentro de una carpeta se ven sus subcarpetas y sus variables sueltas. «Todas» y la búsqueda
  // siguen mostrando todo junto, porque ahí no hay un nivel.
  const showsLevel = currentFolder !== null && !search
  const levelChildren = showsLevel ? childrenAt(subfoldersOf(snap.vars, currentFolder.id), subfolder) : []
  const folderRows: FolderRow[] = levelChildren
    .map((child) => ({ prefix: child.prefix, label: child.label, count: visibleVars.filter((variable) => inSubfolder(variable.short, child.prefix)).length }))
    .filter((row) => row.count > 0)
  const levelVars = showsLevel ? visibleVars.filter((variable) => isDirectlyIn(variable.short, subfolder, levelChildren)) : visibleVars
  const emptyText = emptyListText({ searching: !!search, filteredByLocation, folderHasVars: folderVars.length > 0 })
  const selected = snap.vars.find((variable) => variable.id === selectedId) ?? null

  /** Copia el nombre (o la referencia) para dárselo a Claude u otra herramienta; el valor no pasa por aquí. */
  async function copyText(text: string) {
    try {
      await call('app:copyText', { text })
      setToast(t('Copiado: {0}', { 0: text }))
    } catch (error) {
      setToast(errorText(error))
    }
  }

  /** Mostrar o copiar el valor: con el PIN si la configuración lo pide, directo si no. */
  async function revealOrCopy(target: VarView, action: 'show' | 'copy') {
    if (props.pinForValues) return setModal({ kind: 'pin', target, action })
    try {
      if (action === 'copy') {
        await call('var:copy', { id: target.id, pin: null })
        setToast(copiedText(target.name))
      } else {
        const response = await call<{ value: string }>('var:reveal', { id: target.id, pin: null })
        setRevealed({ id: target.id, value: response.value })
      }
    } catch (error) {
      setToast(errorText(error))
    }
  }

  const selectionCommands: Record<SelectionCommand, (target: VarView) => void> = {
    editVar: (target) => setModal({ kind: 'var', edit: target }),
    moveVar: (target) => setModal({ kind: 'move', target }),
    deleteVar: (target) => setModal({ kind: 'delete', target }),
    copyName: (target) => void copyText(target.name),
    copyValue: (target) => void revealOrCopy(target, 'copy')
  }

  function runCommand(name: MainCommand) {
    if (name in selectionCommands) {
      if (!selected) return setToast(NO_SELECTION_TEXT)
      return selectionCommands[name as SelectionCommand](selected)
    }
    if (name === 'newVar') setModal({ kind: 'var', edit: null })
    if (name === 'newFolder') setModal({ kind: 'folder', mode: { kind: 'new' } })
    if (name === 'import') setModal({ kind: 'import' })
    if (name === 'export') setModal({ kind: 'export' })
    if (name === 'wipe') setModal({ kind: 'wipe' })
    if (name === 'search') searchRef.current?.focus()
    if (name === 'view-all') setLocationId('all')
    if (name === 'view-vault') setLocationId('vault')
    if (name === 'view-env') setLocationId('env')
  }

  // cada pedido del menú o de un atajo llega una vez: el número cambia aunque se pida lo mismo
  useEffect(() => {
    if (props.command) runCommand(props.command.name)
  }, [props.command?.seq])

  /** Cierra el diálogo, recarga la bóveda y opcionalmente selecciona y avisa. */
  async function afterChange(selectId?: string | null, message?: string) {
    setModal(null)
    await reload()
    if (selectId !== undefined) setSelectedId(selectId)
    if (message) setToast(message)
  }

  return (
    <div className="main">
      <div className="toolbar">
        <input ref={searchRef} className="search" placeholder={t('Buscar por nombre o carpeta…')} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('Buscar')} />
        <button className="btn primary" onClick={() => setModal({ kind: 'var', edit: null })}>
          {t('+ Nueva')}
        </button>
        <button className="btn with-icon" onClick={() => void call('vault:lock')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
          {t('Bloquear')}
        </button>
      </div>

      <div className="columns">
        <FolderPanel
          folders={snap.folders}
          vars={snap.vars}
          location={locationId}
          onLocation={setLocationId}
          selected={folderId}
          selectedSubfolder={subfolder}
          onSelect={(id, prefix) => {
            setFolderId(id)
            setSubfolder(prefix)
          }}
          onContextMenu={(folder, x, y) => setMenu({ kind: 'folder', folder, x, y })}
          onNewFolder={() => setModal({ kind: 'folder', mode: { kind: 'new' } })}
        />
        <VarTable
          title={filteredByLocation ? `${folderTitle} · ${location.label}` : folderTitle}
          subtitle={filteredByLocation ? location.hint : subfolder ? t('Todo lo que empieza con {0}', { 0: namePrefix }) : folderSubtitle(currentFolder)}
          folders={folderRows}
          vars={levelVars}
          namePrefix={namePrefix}
          onOpenFolder={setSubfolder}
          freshCount={snap.vars.filter((variable) => variable.state === 'Nueva').length}
          emptyText={emptyText}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={(variable) => setModal({ kind: 'var', edit: variable })}
          onContextMenu={(variable, x, y) => setMenu({ kind: 'var', variable, x, y })}
        />
        <DetailPanel
          variable={selected}
          folderName={selected && folderOf(selected.folderId) ? breadcrumb(folderOf(selected.folderId)!, selected.short) : ''}
          revealedValue={selected && revealed?.id === selected.id ? revealed.value : null}
          onShow={() => selected && void revealOrCopy(selected, 'show')}
          onHide={() => setRevealed(null)}
          onCopy={() => selected && void revealOrCopy(selected, 'copy')}
          onCopyName={() => selected && void copyText(selected.name)}
          onEdit={() => selected && setModal({ kind: 'var', edit: selected })}
          onMove={() => selected && setModal({ kind: 'move', target: selected })}
          onDelete={() => selected && setModal({ kind: 'delete', target: selected })}
        />
      </div>

      {menu?.kind === 'var' && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => void copyText(menu.variable.name)}>
            {t('Copiar nombre')}<span className="ctx-key">Ctrl+C</span>
          </button>
          {menu.variable.publish && <button onClick={() => void copyText(`$env:${menu.variable.name}`)}>{t('Copiar {0}', { 0: '$env:' + menu.variable.name })}</button>}
          <div className="ctx-separator" />
          <button onClick={() => setModal({ kind: 'var', edit: menu.variable })}>{t('Editar')}</button>
          <button onClick={() => setModal({ kind: 'move', target: menu.variable })}>{t('Mover a carpeta')}</button>
          <button onClick={() => setModal({ kind: 'delete', target: menu.variable })}>{t('Eliminar')}</button>
        </div>
      )}
      {menu?.kind === 'folder' && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => setModal({ kind: 'folder', mode: { kind: 'edit', folder: menu.folder } })}>{t('Editar')}</button>
          <button disabled={menu.folder.id === GENERAL_ID} onClick={() => setModal({ kind: 'folder', mode: { kind: 'delete', folder: menu.folder } })}>
            {t('Borrar')}
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}

      {modal?.kind === 'var' && (
        <VariableDialog
          snap={snap}
          edit={modal.edit}
          folderId={currentFolder?.id ?? GENERAL_ID}
          pinForValues={props.pinForValues}
          onClose={() => setModal(null)}
          onSaved={(id) => void afterChange(id)}
          onDelete={(variable) => setModal({ kind: 'delete', target: variable })}
        />
      )}
      {modal?.kind === 'folder' && (
        <FolderDialog
          snap={snap}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSaved={(savedId) => {
            setFolderId(modal.mode.kind === 'delete' || !savedId ? ALL_FOLDERS : savedId)
            // con el código cambiado o la carpeta borrada, la subcarpeta elegida puede no existir más
            setSubfolder(null)
            void afterChange()
          }}
        />
      )}
      {modal?.kind === 'pin' && (
        <PinDialog
          target={modal.target}
          action={modal.action}
          onClose={() => setModal(null)}
          onRevealed={(value) => {
            setRevealed({ id: modal.target.id, value })
            setModal(null)
          }}
          onCopied={() => {
            setModal(null)
            setToast(copiedText(modal.target.name))
          }}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmDeleteDialog target={modal.target} onClose={() => setModal(null)} onDeleted={() => void afterChange(null, t('{0} eliminada.', { 0: modal.target.name }))} />
      )}
      {modal?.kind === 'move' && <MoveDialog snap={snap} target={modal.target} onClose={() => setModal(null)} onMoved={() => void afterChange(modal.target.id)} />}
      {modal?.kind === 'export' && <ExportDialog snap={snap} onClose={() => setModal(null)} onDone={(message) => void afterChange(undefined, message)} />}
      {modal?.kind === 'import' && <ImportDialog onClose={() => setModal(null)} onDone={(message) => void afterChange(undefined, message)} />}
      {modal?.kind === 'wipe' && (
        <WipeDialog snap={snap} onClose={() => setModal(null)} onExportFirst={() => setModal({ kind: 'export' })} onDone={(message) => void afterChange(null, message)} />
      )}
      {modal?.kind === 'help' && (
        <HelpDialog
          onClose={() => {
            setModal(null)
            props.onHelpClose()
          }}
        />
      )}
    </div>
  )
}
