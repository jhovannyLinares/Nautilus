import { t } from '@shared/i18n'
import koffi from 'koffi'
import { VaultError } from './errors'

/** Dónde vive cada valor. La bóveda solo conoce esta interfaz. */
export interface SecretStore {
  get(name: string): string | null
  set(name: string, value: string): void
  delete(name: string): void
  /**
   * Las mismas tres, en otro hilo. Escribir o borrar una credencial tardó ~1,3 s por llamada (medido el 2026-10-29):
   * importar o vaciar cientos de variables con las síncronas congela la ventana minutos.
   */
  getAsync(name: string): Promise<string | null>
  setAsync(name: string, value: string): Promise<void>
  deleteAsync(name: string): Promise<void>
}

const CRED_TYPE_GENERIC = 1
/** Se queda en este equipo: no viaja con un perfil móvil de Windows (CRED_PERSIST_ENTERPRISE sí viajaría). */
const CRED_PERSIST_LOCAL_MACHINE = 2

/** Una función de koffi: se llama directo, o con `.async(...args, callback)` en un hilo aparte. */
type NativeFunction<Args extends unknown[]> = ((...args: Args) => boolean) & {
  async: (...argsAndCallback: [...Args, (error: unknown, result: boolean) => void]) => void
}

type CredApi = {
  write: NativeFunction<[cred: object, flags: number]>
  read: NativeFunction<[target: string, type: number, flags: number, out: unknown[]]>
  remove: NativeFunction<[target: string, type: number, flags: number]>
  free: (p: unknown) => void
  decodeCred: (p: unknown) => { CredentialBlobSize: number; CredentialBlob: unknown }
  decodeBlob: (p: unknown, size: number) => Buffer
}

let cred: CredApi | null = null
function api(): CredApi {
  if (cred) return cred
  const advapi = koffi.load('advapi32.dll')
  const FILETIME = koffi.struct('FILETIME', { dwLowDateTime: 'uint32', dwHighDateTime: 'uint32' })
  const CREDENTIALW = koffi.struct('CREDENTIALW', {
    Flags: 'uint32',
    Type: 'uint32',
    TargetName: 'str16',
    Comment: 'str16',
    LastWritten: FILETIME,
    CredentialBlobSize: 'uint32',
    CredentialBlob: 'void *',
    Persist: 'uint32',
    AttributeCount: 'uint32',
    Attributes: 'void *',
    TargetAlias: 'str16',
    UserName: 'str16'
  })
  const write = advapi.func('bool __stdcall CredWriteW(CREDENTIALW *cred, uint32 flags)')
  const read = advapi.func('bool __stdcall CredReadW(str16 target, uint32 type, uint32 flags, _Out_ void **cred)')
  const remove = advapi.func('bool __stdcall CredDeleteW(str16 target, uint32 type, uint32 flags)')
  const free = advapi.func('void __stdcall CredFree(void *buffer)')
  cred = {
    write: write as CredApi['write'],
    read: read as CredApi['read'],
    remove: remove as CredApi['remove'],
    free,
    decodeCred: (p) => koffi.decode(p, CREDENTIALW),
    decodeBlob: (p, size) => Buffer.from(koffi.decode(p, koffi.array('uint8_t', size)) as number[])
  }
  return cred
}

/**
 * Credenciales genéricas del Administrador de credenciales de Windows, con destino `{prefix}{nombre}`
 * (p. ej. `nautilus:NAU_UY_INSIS_PASS`) y persistencia local, por la API Win32 directa.
 * No se usa @napi-rs/keyring: no deja elegir la persistencia (guarda como «empresarial», que viaja con un perfil
 * móvil) y con `withTarget` lee vacío desde otro objeto. Ambas cosas probadas el 2026-10-28.
 * Los errores de Windows se reemplazan por un mensaje propio: nunca se reenvía texto que pudiera traer el valor.
 */
export function credentialStore(prefix = 'nautilus:'): SecretStore {
  /** Lee el valor de la credencial que dejó CredReadW en `out` y la libera. */
  function valueFrom(out: unknown[]): string {
    try {
      const c = api().decodeCred(out[0])
      if (!c.CredentialBlobSize) return ''
      return api().decodeBlob(c.CredentialBlob, c.CredentialBlobSize).toString('utf16le')
    } finally {
      api().free(out[0])
    }
  }

  function credentialFor(name: string, value: string): object {
    const blob = Buffer.from(value, 'utf16le')
    return {
      Flags: 0,
      Type: CRED_TYPE_GENERIC,
      TargetName: prefix + name,
      Comment: null,
      LastWritten: { dwLowDateTime: 0, dwHighDateTime: 0 },
      CredentialBlobSize: blob.length,
      CredentialBlob: blob.length ? blob : null,
      Persist: CRED_PERSIST_LOCAL_MACHINE,
      AttributeCount: 0,
      Attributes: null,
      TargetAlias: null,
      UserName: name
    }
  }

  function writeFailed(name: string): VaultError {
    return new VaultError('STORE', t('No se pudo guardar {0} en el Administrador de credenciales.', { 0: name }))
  }

  return {
    get(name) {
      const out: unknown[] = [null]
      if (!api().read(prefix + name, CRED_TYPE_GENERIC, 0, out)) return null
      return valueFrom(out)
    },
    set(name, value) {
      if (!api().write(credentialFor(name, value), 0)) throw writeFailed(name)
    },
    delete(name) {
      // false = no existía: no hay nada que borrar
      api().remove(prefix + name, CRED_TYPE_GENERIC, 0)
    },
    async getAsync(name) {
      const out: unknown[] = [null]
      const found = await inThread(api().read, [prefix + name, CRED_TYPE_GENERIC, 0, out])
      return found ? valueFrom(out) : null
    },
    async setAsync(name, value) {
      if (!(await inThread(api().write, [credentialFor(name, value), 0]))) throw writeFailed(name)
    },
    async deleteAsync(name) {
      await inThread(api().remove, [prefix + name, CRED_TYPE_GENERIC, 0])
    }
  }
}

/** Corre la función de Windows en un hilo de koffi; el error de koffi no lleva el valor (solo argumentos de puntero). */
function inThread<Args extends unknown[]>(native: NativeFunction<Args>, args: Args): Promise<boolean> {
  return new Promise((resolve, reject) => native.async(...args, (error, result) => (error ? reject(error) : resolve(result))))
}
