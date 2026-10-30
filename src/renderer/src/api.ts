import type { AppEvent, Channel } from '@shared/ipc-contracts'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** Llama a main por un canal tipado. Si main responde error, lanza ApiError con el mensaje para mostrar. */
export async function call<T = unknown>(channel: Channel, payload: object = {}): Promise<T> {
  const r = (await window.api.invoke(channel, payload)) as { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
  if (!r.ok) throw new ApiError(r.error.code, r.error.message)
  return r.data
}

export function onAppEvent(cb: (e: AppEvent) => void): () => void {
  return window.api.onEvent((e) => cb(e as AppEvent))
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
