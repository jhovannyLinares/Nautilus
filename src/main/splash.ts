import { BrowserWindow, nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import logoPath from '../../resources/logo.png?asset'

/**
 * HTML de la pantalla de carga: el Escudo nadando, «NAUTILUS» y el texto de carga.
 * Solo CSS, sin scripts; el logo va embebido como data URL.
 */
export function splashHtml(loading: string, logoDataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Nautilus</title><style>
:root{color-scheme:light dark;--bg:#1c1e23;--title:#ffffff;--sub:rgba(255,255,255,0.6)}
@media (prefers-color-scheme:light){:root{--bg:#f4f5f7;--title:#16181d;--sub:#5d6470}}
html,body{margin:0;height:100%;background:var(--bg);overflow:hidden;font-family:'Open Sans',Arial,sans-serif;-webkit-user-select:none;user-select:none}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;-webkit-app-region:drag}
.nt-swim{animation:nt-swim 2.6s ease-in-out infinite}
@keyframes nt-swim{0%,100%{transform:translate(0,0) rotate(0deg)}50%{transform:translate(-6px,-5px) rotate(-3deg)}}
h1{margin:0;font-size:30px;font-weight:600;letter-spacing:6px;color:var(--title)}
p{margin:0;font-size:13px;color:var(--sub)}
</style></head><body>
<img class="nt-swim" src="${logoDataUrl}" width="190" height="190" alt="">
<h1>NAUTILUS</h1><p>${loading}</p>
</body></html>`
}

// sin este mínimo el logo parpadea: el renderer del splash y el de la ventana principal terminan casi a la vez
const SPLASH_MIN_VISIBLE_MS = 1_500

let logoPaintedAt: number | null = null

/**
 * Abre la pantalla de carga: sin marco, encima, sin Node ni preload. Se muestra recién cuando pintó, para que
 * el marco y el logo aparezcan juntos y no un recuadro vacío. Se cierra con `closeWhenSeen`.
 */
export function openSplash(loading: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 260,
    height: 480,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
    backgroundColor: windowBackground(),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: false }
  })
  const logo = 'data:image/png;base64,' + readFileSync(logoPath).toString('base64')
  win.once('ready-to-show', () => {
    win.show()
    logoPaintedAt = Date.now()
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(loading, logo))}`)
  return win
}

/** Cierra la pantalla de carga solo cuando el logo ya se vio: si aún no cargó, espera a que cargue y deja el mínimo visible. */
export function closeWhenSeen(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (logoPaintedAt === null) {
    win.once('ready-to-show', () => closeWhenSeen(win))
    return
  }
  const visibleMs = Date.now() - logoPaintedAt
  const remainingMs = Math.max(0, SPLASH_MIN_VISIBLE_MS - visibleMs)
  setTimeout(() => {
    if (!win.isDestroyed()) win.close()
  }, remainingMs)
}

/** Fondo de la ventana mientras carga la página: evita un destello oscuro con Windows en tema claro. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1e23' : '#f4f5f7'
}
