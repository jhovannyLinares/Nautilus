import { t } from '@shared/i18n'
import type { LocationId } from './FolderPanel'

/** Lo que se pide desde la barra de menús o un atajo de teclado y resuelve la ventana principal. */
export type MainCommand =
  | 'newVar'
  | 'newFolder'
  | 'import'
  | 'export'
  | 'wipe'
  | 'search'
  | `view-${LocationId}`
  | SelectionCommand

/** Las que actúan sobre la variable elegida. */
export type SelectionCommand = 'editVar' | 'moveVar' | 'deleteVar' | 'copyName' | 'copyValue'

/** Lo que resuelve el marco de la app: no depende de la ventana principal. */
export type AppCommand = 'lock' | 'quit' | 'settings' | 'help' | 'about'

export type Command = MainCommand | AppCommand

/** Cada pedido lleva un número: pedir dos veces lo mismo vuelve a ejecutarlo. */
export interface CommandRequest {
  name: MainCommand
  seq: number
}

/** Atajo → comando. La tecla se escribe como la arma `shortcutOf`: `ctrl+shift+n`, `f2`, `delete`. */
export const SHORTCUTS: Readonly<Record<string, Command>> = {
  'ctrl+n': 'newVar',
  'ctrl+shift+n': 'newFolder',
  'ctrl+l': 'lock',
  f2: 'editVar',
  delete: 'deleteVar',
  'ctrl+c': 'copyName',
  'ctrl+shift+c': 'copyValue',
  'ctrl+f': 'search',
  'ctrl+,': 'settings',
  f1: 'help'
}

/** Atajos que también editan texto: mientras se escribe o hay texto marcado, se deja la acción normal. */
export const TEXT_SHORTCUTS: ReadonlySet<string> = new Set(['ctrl+c', 'delete'])

const APP_COMMANDS: ReadonlySet<Command> = new Set<AppCommand>(['lock', 'quit', 'settings', 'help', 'about'])

export function isAppCommand(name: Command): name is AppCommand {
  return APP_COMMANDS.has(name)
}

export function shortcutOf(event: KeyboardEvent): string {
  const modifiers = (event.ctrlKey ? 'ctrl+' : '') + (event.shiftKey ? 'shift+' : '')
  return modifiers + event.key.toLowerCase()
}

/** Se está escribiendo en un campo o hay texto marcado: Ctrl+C y Supr son del texto, no de la variable. */
export function isEditingText(event: KeyboardEvent): boolean {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
  const hasTextSelected = (window.getSelection()?.toString() ?? '') !== ''
  return typing || hasTextSelected
}

const KEY_LABELS: Readonly<Record<string, string>> = { ctrl: 'Ctrl', shift: t('Mayús'), delete: t('Supr') }

/** «Ctrl+Mayús+N» para el menú, o '' si el comando no tiene atajo. */
export function shortcutLabel(name: Command): string {
  const shortcut = Object.keys(SHORTCUTS).find((key) => SHORTCUTS[key] === name)
  if (!shortcut) return ''
  return shortcut
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part.toUpperCase())
    .join('+')
}
