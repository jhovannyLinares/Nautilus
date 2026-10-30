import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { SOON_DAYS, type VarState } from '@shared/names'
import type { AppStatus, ClaudeState, Snapshot } from '@shared/view'
import logo from '../../../resources/logo.png'
import { call, onAppEvent } from './api'
import { isAppCommand, isEditingText, shortcutLabel, shortcutOf, SHORTCUTS, TEXT_SHORTCUTS, type Command, type CommandRequest } from './commands'
import { LOCATIONS } from './FolderPanel'
import { LockScreen } from './LockScreen'
import { MainView } from './MainView'
import { MenuBar, type Menu, type MenuItem } from './MenuBar'
import { AboutDialog, HelpDialog as HelpDialogLocked, SettingsDialog } from './SmallDialogs'

const ACTIVITY_THROTTLE_MS = 15_000

const CLAUDE_LABELS: Record<ClaudeState, string> = {
  on: t('Claude Code: conectado'),
  off: t('Claude Code: apagado'),
  noclaude: t('Claude Code: listo, falta instalarlo')
}

/** Marco de la app: barra superior con los menús, pantalla de bloqueo o ventana principal, y barra inferior. */
export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [command, setCommand] = useState<CommandRequest | null>(null)

  const refresh = useCallback(async () => {
    const s = await call<AppStatus>('vault:status')
    setStatus(s)
    setSnap(s.unlocked ? await call<Snapshot>('vault:snapshot') : null)
  }, [])

  useEffect(() => {
    void refresh().then(() => call('app:ready'))
    const stopListening = onAppEvent((event) => {
      if (event.type === 'locked') void refresh()
    })
    // el estado de la barra superior («se bloquea en n min») se refresca solo
    const poll = setInterval(() => void refresh(), 30_000)
    return () => {
      stopListening()
      clearInterval(poll)
    }
  }, [refresh])

  // el uso de la ventana posterga el bloqueo automático
  useEffect(() => {
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < ACTIVITY_THROTTLE_MS) return
      last = now
      // si falla, el bloqueo automático llega antes de tiempo: se avisa en consola, que main pasa al registro
      void call('app:activity').catch((error: unknown) => console.error('No se pudo avisar actividad:', error))
    }
    window.addEventListener('mousemove', ping)
    window.addEventListener('keydown', ping)
    return () => {
      window.removeEventListener('mousemove', ping)
      window.removeEventListener('keydown', ping)
    }
  }, [])

  const unlocked = !!status?.unlocked && !!snap

  /** Lo del marco se resuelve aquí; lo demás va a la ventana principal, que solo existe desbloqueada. */
  function run(name: Command) {
    if (!isAppCommand(name)) {
      if (unlocked) setCommand((previous) => ({ name, seq: (previous?.seq ?? 0) + 1 }))
      return
    }
    if (name === 'lock') void call('vault:lock')
    if (name === 'quit') void call('app:quit')
    if (name === 'settings') setSettingsOpen(true)
    if (name === 'help') setHelpOpen(true)
    if (name === 'about') setAboutOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutOf(event)
      const name = SHORTCUTS[shortcut]
      if (!name) return
      // con un diálogo abierto, el teclado es del diálogo
      if (document.querySelector('[role="dialog"]')) return
      if (TEXT_SHORTCUTS.has(shortcut) && isEditingText(event)) return
      event.preventDefault()
      run(name)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function item(label: string, name: Command, extra: Partial<MenuItem> = {}): MenuItem {
    return { label, keys: shortcutLabel(name), onSelect: () => run(name), disabled: !isAppCommand(name) && !unlocked, ...extra }
  }

  const menus: Menu[] = [
    {
      label: t('Archivo'),
      items: [
        item(t('Nueva variable…'), 'newVar'),
        item(t('Nueva carpeta…'), 'newFolder'),
        item(t('Importar variables…'), 'import', { separatorBefore: true }),
        item(t('Exportar variables…'), 'export'),
        item(t('Bloquear'), 'lock', { separatorBefore: true, disabled: !unlocked }),
        item(t('Salir'), 'quit', { keys: 'Alt+F4' })
      ]
    },
    {
      label: t('Editar'),
      items: [
        item(t('Editar variable…'), 'editVar'),
        item(t('Mover a carpeta…'), 'moveVar'),
        item(t('Eliminar…'), 'deleteVar'),
        item(t('Copiar nombre'), 'copyName', { separatorBefore: true }),
        item(t('Copiar valor'), 'copyValue'),
        item(t('Buscar'), 'search', { separatorBefore: true })
      ]
    },
    { label: t('Ver'), items: LOCATIONS.map((location) => item(location.id === 'all' ? t('Todas las variables') : location.label, `view-${location.id}`)) },
    {
      label: t('Herramientas'),
      items: [
        item(t('Configuración…'), 'settings'),
        item(t('Integración con Claude Code…'), 'settings', { keys: '' }),
        item(t('Vaciar la bóveda…'), 'wipe', { separatorBefore: true, danger: true })
      ]
    },
    { label: t('Ayuda'), items: [item(t('Lo que conviene saber'), 'help'), item(t('Acerca de Nautilus'), 'about')] }
  ]

  return (
    <div className="app">
      <header className="topbar">
        <img src={logo} width={20} height={20} alt="" />
        <span className="brand">{'NAUTILUS'}</span>
        <MenuBar menus={menus} />
        <span className="topbar-status">
          <span className={'dot ' + (unlocked ? 'dot-ok' : 'dot-locked')} />
          {unlocked ? t('Desbloqueada · variables publicadas · se bloquea en {0} min', { 0: status!.lockInMin ?? '' }) : t('Bloqueada')}
        </span>
      </header>

      <main className="body">
        {status && !unlocked && <LockScreen key={String(status.hasPin)} hasPin={status.hasPin} total={status.total} onUnlocked={() => void refresh()} />}
        {unlocked && (
          <MainView
            snap={snap!}
            reload={refresh}
            pinForValues={status!.pinForValues}
            command={command}
            helpOpen={helpOpen}
            onHelpClose={() => setHelpOpen(false)}
          />
        )}
      </main>

      <footer className="statusbar">
        <span>{unlocked ? t('{0} variables · {1} publicadas como variables de entorno', { 0: snap!.vars.length, 1: snap!.published }) : t('Bloqueada · 0 variables publicadas')}</span>
        {unlocked && <ExpiryCounts states={snap!.vars.map((variable) => variable.state)} />}
        {status && (
          <button className="link small" onClick={() => setSettingsOpen(true)}>
            {t('Se bloquea sola tras')}{' '}{status.autoLockMin}{' '}{t('min · Cambiar')}
          </button>
        )}
        {status && (
          <button className="link small claude-link" onClick={() => setSettingsOpen(true)}>
            <span className={'dot claude-' + status.claude} />
            {CLAUDE_LABELS[status.claude]}
          </button>
        )}
        <span className="statusbar-right">{t('Cifrado: Administrador de credenciales de Windows')}</span>
      </footer>

      {settingsOpen && status && (
        <SettingsDialog
          status={status}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false)
            void refresh()
          }}
        />
      )}
      {aboutOpen && status && <AboutDialog version={status.version} onClose={() => setAboutOpen(false)} />}
      {helpOpen && !unlocked && <HelpDialogLocked onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

/** Aviso de la barra inferior: cuántas claves ya vencieron y cuántas están por vencer. Nada si no hay ninguna. */
function ExpiryCounts(props: { states: VarState[] }) {
  const expired = props.states.filter((state) => state === 'Vencida').length
  const soon = props.states.filter((state) => state === 'Vence pronto').length
  return (
    <>
      {expired > 0 && (
        <span className="expiry-count expired">
          <span className="dot dot-expired" />
          {expired === 1 ? t('1 vencida') : t('{0} vencidas', { 0: expired })}
        </span>
      )}
      {soon > 0 && (
        <span className="expiry-count soon">
          <span className="dot dot-soon" />
          {soon === 1 ? t('1 vence en {0} días o menos', { 0: SOON_DAYS }) : t('{0} vencen en {1} días o menos', { 0: soon, 1: SOON_DAYS })}
        </span>
      )}
    </>
  )
}
