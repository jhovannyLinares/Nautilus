import koffi from 'koffi'

/** Publica variables de entorno de usuario. La bóveda solo conoce esta interfaz. */
export interface EnvPublisher {
  set(name: string, value: string): void
  remove(name: string): void
  /** Avisa a Windows que cambió el entorno, para que los programas que se abran después lo vean. */
  flush(): void
}

const HKCU = 0x80000001
const REG_SZ = 1
const HWND_BROADCAST = 0xffff
const WM_SETTINGCHANGE = 0x001a
const SMTO_ABORTIFHUNG = 0x0002

type Win32 = {
  setValue: (hKey: number, sub: string, name: string, type: number, data: Buffer, len: number) => number
  deleteValue: (hKey: number, sub: string, name: string) => number
  broadcast: (hWnd: number, msg: number, wParam: number, lParam: string, flags: number, timeout: number, res: number[]) => number
}

let win32: Win32 | null = null
function api(): Win32 {
  if (win32) return win32
  const advapi = koffi.load('advapi32.dll')
  const user32 = koffi.load('user32.dll')
  win32 = {
    setValue: advapi.func('long __stdcall RegSetKeyValueW(uintptr_t hKey, str16 sub, str16 name, uint32 type, const void *data, uint32 len)'),
    deleteValue: advapi.func('long __stdcall RegDeleteKeyValueW(uintptr_t hKey, str16 sub, str16 name)'),
    broadcast: user32.func(
      'intptr_t __stdcall SendMessageTimeoutW(uintptr_t hWnd, uint32 msg, uintptr_t wParam, str16 lParam, uint32 flags, uint32 timeout, _Out_ uintptr_t *res)'
    )
  }
  return win32
}

/**
 * `HKCU\Environment` por Win32, sin procesos intermedios: pasar el valor como argumento a otro programa
 * lo dejaría visible en la lista de procesos.
 */
export function windowsEnvironment(): EnvPublisher {
  return {
    set(name, value) {
      const data = Buffer.from(value + '\0', 'utf16le')
      const rc = api().setValue(HKCU, 'Environment', name, REG_SZ, data, data.length)
      if (rc !== 0) throw new Error(`No se pudo publicar ${name} (código ${rc}).`)
    },
    remove(name) {
      // 2 = no existía; cualquier otro código distinto de 0 es un error real
      const rc = api().deleteValue(HKCU, 'Environment', name)
      if (rc !== 0 && rc !== 2) throw new Error(`No se pudo retirar ${name} (código ${rc}).`)
    },
    flush() {
      api().broadcast(HWND_BROADCAST, WM_SETTINGCHANGE, 0, 'Environment', SMTO_ABORTIFHUNG, 5000, [0])
    }
  }
}
