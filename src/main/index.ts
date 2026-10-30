import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, session, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { contracts, isChannel, type AppEvent, type Channel, type ChannelRequest, type RpcResult } from '@shared/ipc-contracts'
import { setLocale, t } from '@shared/i18n'
import iconPath from '../../resources/logo.png?asset'
import skillTemplate from '../../resources/claude/SKILL.md?raw'
import importScript from '../../resources/claude/importar.ps1?raw'
import { ClaudeSkill } from '../backend/claude-skill'
import { windowsEnvironment } from '../backend/environment'
import { VaultError } from '../backend/errors'
import { OpLog } from '../backend/op-log'
import { credentialStore } from '../backend/secrets'
import { Vault } from '../backend/vault'
import { exportExtension, type ExportFormat } from '@shared/view'
import { closeWhenSeen, openSplash, windowBackground } from './splash'
import { checkExportPath, defaultExportPath, inspectImportFile, readImportText, writeExport } from './transfer-files'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const CLIPBOARD_CLEAR_MS = 30_000
const IDLE_CHECK_MS = 15_000
const SPLASH_TIMEOUT_MS = 20_000
const INTERNAL_ERROR_TEXT = t('Algo falló. No se cambió nada que no se viera en pantalla.')

// NAUTILUS_PROFILE=x: datos en %APPDATA%\Nautilus\perfiles\x y credenciales con destino nautilus-x:{NOMBRE}.
// Sirve para probar sin tocar la bóveda real. Va antes del bloqueo de instancia única, que depende de userData.
const profile = process.env.NAUTILUS_PROFILE?.replace(/[^a-z0-9-]/gi, '') || null
if (profile) app.setPath('userData', join(app.getPath('userData'), 'perfiles', profile))
const CREDENTIAL_PREFIX = profile ? `nautilus-${profile}:` : 'nautilus:'

let mainWindow: BrowserWindow | null = null
let splash: BrowserWindow | null = null
let vault: Vault
let appLog: OpLog
let claudeSkill: ClaudeSkill

/**
 * Pone el skill de Claude al día con el interruptor. Si el disco falla, Nautilus sigue funcionando:
 * se registra y la barra inferior muestra lo que diga el estado del archivo.
 */
function syncClaudeSkill(): void {
  try {
    claudeSkill.sync(vault.claudeSkillEnabled())
  } catch (error) {
    appLog.write({ source: 'app', op: 'claude-skill', result: 'error', message: t('No se pudo actualizar {0}: {1}', { 0: claudeSkill.file, 1: (error as Error).message }) })
  }
}

function closeSplash(): void {
  if (splash) closeWhenSeen(splash)
  splash = null
}

function sendEvent(event: AppEvent): void {
  mainWindow?.webContents.send('app-event', event)
}

/** Bloquea y borra el secreto copiado. Devuelve si estaba desbloqueada. Un fallo al retirar no impide bloquear. */
function lockVault(): boolean {
  clearCopiedSecret()
  if (!vault?.isUnlocked()) return false
  try {
    vault.lock()
  } catch (error) {
    appLog.write({ source: 'app', op: 'lock', result: 'error', message: t('Bloqueada, pero no se pudo retirar todo del entorno: {0}', { 0: (error as Error).message }) })
  }
  return true
}

function lockNow(reason: Extract<AppEvent, { type: 'locked' }>['reason']): void {
  if (lockVault()) sendEvent({ type: 'locked', reason })
}

// CSP: producción estricta; dev permite script inline de Vite y websocket de recarga
const CSP = isDev
  ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://localhost:*"
  : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Nautilus',
    icon: iconPath,
    backgroundColor: windowBackground(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  // la pantalla de carga sigue encima hasta que el renderer avisa que pintó (app:ready)
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // nada navega fuera de la app; enlaces https se abren en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.on('console-message', (event) => {
    // el texto no se guarda: un error de la ventana puede arrastrar lo que había en pantalla, y el log nunca lleva valores
    if (event.level === 'error') appLog.write({ source: 'renderer', message: 'Error en la ventana (texto omitido).', where: `${event.sourceId}:${event.lineNumber}` })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) =>
    appLog.write({ source: 'ventana', message: `La ventana se cayó: ${details.reason} (código ${details.exitCode}).` })
  )

  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Solo acepta IPC desde la ventana principal y su origen esperado. */
function trustedSender(e: IpcMainInvokeEvent): boolean {
  if (!mainWindow || e.sender !== mainWindow.webContents) return false
  const url = e.senderFrame?.url ?? ''
  return isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('file://')
}

/** El último secreto copiado, mientras pueda seguir en el portapapeles. */
let copiedSecret: string | null = null

/** Copia el valor y lo borra del portapapeles a los 30 s, o antes si Nautilus se bloquea o se cierra. */
function copySecret(value: string): void {
  clipboard.writeText(value)
  copiedSecret = value
  setTimeout(clearCopiedSecret, CLIPBOARD_CLEAR_MS)
}

/** Solo borra si el portapapeles todavía tiene el secreto: no pisa lo que el usuario copió después. */
function clearCopiedSecret(): void {
  if (copiedSecret === null) return
  if (clipboard.readText() === copiedSecret) clipboard.clear()
  copiedSecret = null
}

/** El avance de importar, exportar o vaciar, para el cuadro que lo muestra. */
function sendProgress(done: number, total: number): void {
  sendEvent({ type: 'progress', done, total })
}

function exportFilter(format: ExportFormat): Electron.FileFilter {
  const name = format === 'plain' ? t('Variables en texto plano') : t('Exportación de Nautilus')
  return { name, extensions: [exportExtension(format).slice(1)] }
}

async function chooseSavePath(format: ExportFormat, current: string): Promise<string | null> {
  const result = await dialog.showSaveDialog(mainWindow!, { title: t('Exportar variables'), defaultPath: current, filters: [exportFilter(format)] })
  return result.canceled || !result.filePath ? null : result.filePath
}

async function chooseOpenPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog(mainWindow!, { title: t('Importar variables'), properties: ['openFile'], filters: [exportFilter('encrypted')] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

const OK = { ok: true } as const

/** Un manejador por canal, con el tipo de pedido que fija su contrato. */
const handlers: { [C in Channel]: (request: ChannelRequest<C>) => unknown } = {
  'app:ready': () => (closeSplash(), OK),
  'app:activity': () => (vault.touch(), OK),
  'app:paste': () => ({ text: clipboard.readText() }),
  'app:openLog': () => (void shell.openPath(appLog.file), OK),
  // el nombre no es secreto: no pide PIN ni se borra del portapapeles como el valor
  'app:copyText': ({ text }) => (clipboard.writeText(text), OK),
  // before-quit bloquea la bóveda, como al cerrar la ventana
  'app:quit': () => (app.quit(), OK),
  'vault:status': () => ({ ...vault.status(), claude: claudeSkill.state(vault.claudeSkillEnabled()), version: app.getVersion() }),
  'vault:snapshot': () => vault.snapshot(),
  'vault:unlock': ({ pin }) => (vault.unlock(pin), OK),
  'vault:lock': () => (lockNow('manual'), OK),
  'pin:create': ({ pin }) => {
    vault.createPin(pin)
    vault.unlock(pin)
    return OK
  },
  'pin:reset': ({ pin }) => (vault.resetPin(pin), OK),
  'var:create': (request) => ({ id: vault.createVar(request) }),
  'var:update': ({ id, ...input }) => (vault.updateVar(id, input), OK),
  'var:delete': ({ id }) => (vault.deleteVar(id), OK),
  'var:reveal': ({ id, pin }) => ({ value: vault.reveal(id, pin) }),
  'var:copy': ({ id, pin }) => (copySecret(vault.reveal(id, pin)), OK),
  'folder:create': (request) => ({ id: vault.createFolder(request) }),
  'folder:update': ({ id, ...input }) => (vault.updateFolder(id, input), OK),
  'folder:delete': ({ id, mode }) => (vault.deleteFolder(id, mode), OK),
  'file:defaultExportPath': ({ format }) => ({ path: defaultExportPath(app.getPath('documents'), format, new Date()) }),
  'file:chooseSave': async ({ format, current }) => ({ path: await chooseSavePath(format, current) }),
  'file:chooseOpen': async () => ({ path: await chooseOpenPath() }),
  'file:inspect': ({ path }) => inspectImportFile(path),
  'vault:export': async ({ path, pin, ...request }) => {
    checkExportPath(path, request.format)
    const { text, count } = await vault.exportText(request, pin, sendProgress)
    writeExport(path, text)
    return { path, count }
  },
  'vault:importPreview': ({ path, password }) => vault.importPreview(readImportText(path), password),
  'vault:importApply': ({ path, password, replace, pin }) => vault.importApply(readImportText(path), password, replace, pin, sendProgress),
  'vault:wipe': ({ pin }) => vault.wipe(pin, sendProgress),
  'settings:autoLock': ({ min }) => (vault.setAutoLock(min), OK),
  'settings:claudeSkill': ({ enabled }) => {
    vault.setClaudeSkill(enabled)
    syncClaudeSkill()
    return OK
  },
  'settings:pinForValues': ({ enabled, pin }) => (vault.setPinForValues(enabled, pin), OK)
}

/** Las que la ventana hace sola cada cierto tiempo no cuentan como uso para el bloqueo automático. */
const BACKGROUND_CHANNELS: ReadonlySet<Channel> = new Set(['vault:status', 'vault:snapshot'])

/** Los diálogos de Windows y las operaciones largas (importar, exportar, vaciar) responden con una promesa. */
async function dispatch<C extends Channel>(channel: C, payload: unknown): Promise<unknown> {
  const request = contracts[channel].req.parse(payload) as ChannelRequest<C>
  if (!BACKGROUND_CHANNELS.has(channel)) vault.touch()
  const data = await handlers[channel](request)
  contracts[channel].res.parse(data)
  return data
}

ipcMain.handle('rpc', async (event, message: unknown): Promise<RpcResult> => {
  if (!trustedSender(event)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Origen no confiable.' } }
  const { channel, payload } = (message ?? {}) as { channel?: unknown; payload?: unknown }
  if (!isChannel(channel)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Canal desconocido.' } }
  try {
    return { ok: true, data: await dispatch(channel, payload) }
  } catch (error) {
    // todo pedido que falla queda registrado; los de la bóveda muestran su texto (escrito sin valores),
    // el resto se muestra genérico y su detalle queda solo en el registro
    if (error instanceof VaultError) {
      appLog.write({ source: 'rpc', channel, code: error.code, message: error.message, result: 'error' })
      return { ok: false, error: { code: error.code, message: error.message } }
    }
    const detail = error instanceof Error ? error.message : String(error)
    const where = error instanceof Error ? error.stack : undefined
    appLog.write({ source: 'rpc', channel, code: 'INTERNAL', message: detail, where, result: 'error' })
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_ERROR_TEXT } }
  }
})

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
})

// una sola Nautilus por usuario: la segunda instancia enfoca la primera
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    setLocale(app.getLocale())
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
    })
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    Menu.setApplicationMenu(null)

    const dataDir = app.getPath('userData')
    appLog = new OpLog(join(dataDir, 'logs', 'nautilus.log'))
    appLog.write({ source: 'app', message: `Nautilus ${app.getVersion()} arranca (Electron ${process.versions.electron}${profile ? `, perfil ${profile}` : ''}).` })
    vault = new Vault({ dir: dataDir, secrets: credentialStore(CREDENTIAL_PREFIX), env: windowsEnvironment(), log: appLog })
    // lo que quedó publicado por un cierre anormal se retira antes de pedir el PIN
    vault.cleanupOnStart()

    // con un perfil de prueba, el skill va a una carpeta personal falsa dentro del perfil: nunca al ~/.claude real
    const claudeHome = profile ? join(dataDir, 'claude-home') : app.getPath('home')
    claudeSkill = new ClaudeSkill({ homeDir: claudeHome, template: skillTemplate, importScript, version: app.getVersion() })
    syncClaudeSkill()

    // bloqueo automático por tiempo sin uso y al bloquear la sesión de Windows
    setInterval(() => {
      if (vault.idleExpired()) lockNow('idle')
    }, IDLE_CHECK_MS)
    powerMonitor.on('lock-screen', () => lockNow('windows'))
    powerMonitor.on('shutdown', () => lockVault())

    // pantalla de carga mientras arranca la ventana; se cierra cuando ya se vio o, si algo falla, a los 20 s aunque no haya pintado
    const loadingWindow = openSplash(t('Cargando…'))
    splash = loadingWindow
    setTimeout(() => {
      if (!loadingWindow.isDestroyed()) loadingWindow.close()
    }, SPLASH_TIMEOUT_MS)
    createWindow()
  })

  // al cerrar Nautilus se retira todo lo publicado
  app.on('before-quit', () => {
    lockVault()
  })
  app.on('window-all-closed', () => app.quit())
}
