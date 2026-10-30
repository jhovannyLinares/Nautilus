import { z } from 'zod'
import { PIN_PATTERN } from './names'
import { EXPORT_FORMATS } from './view'

const pin = z.string().regex(PIN_PATTERN)
const id = z.string().min(1)
const filePath = z.string().min(1)
const exportFormat = z.enum(EXPORT_FORMATS)
const filePassword = z.string().nullable()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const varInput = z.object({
  folderId: id,
  short: z.string(),
  value: z.string().nullable(),
  expires: date,
  publish: z.boolean(),
  user: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional()
})
const folderInput = z.object({ name: z.string(), code: z.string(), color: z.string() })
const ok = z.object({ ok: z.literal(true) })
const any = z.unknown()

/** Contrato de cada canal: lo que pide la ventana y lo que responde main. Se valida en los dos extremos. */
export const contracts = {
  'app:ready': { req: z.object({}), res: ok },
  'app:activity': { req: z.object({}), res: ok },
  'app:paste': { req: z.object({}), res: z.object({ text: z.string() }) },
  'app:openLog': { req: z.object({}), res: ok },
  'app:copyText': { req: z.object({ text: z.string().min(1) }), res: ok },
  'app:quit': { req: z.object({}), res: ok },
  'vault:status': { req: z.object({}), res: any },
  'vault:snapshot': { req: z.object({}), res: any },
  'vault:unlock': { req: z.object({ pin }), res: ok },
  'vault:lock': { req: z.object({}), res: ok },
  'pin:create': { req: z.object({ pin }), res: ok },
  'pin:reset': { req: z.object({ pin }), res: ok },
  'var:create': { req: varInput, res: z.object({ id }) },
  'var:update': { req: varInput.extend({ id }), res: ok },
  'var:delete': { req: z.object({ id }), res: ok },
  // pin null = sin PIN: vale solo si la configuración no lo pide para mostrar y copiar
  'var:reveal': { req: z.object({ id, pin: pin.nullable() }), res: z.object({ value: z.string() }) },
  'var:copy': { req: z.object({ id, pin: pin.nullable() }), res: ok },
  'folder:create': { req: folderInput, res: z.object({ id }) },
  'folder:update': { req: folderInput.extend({ id }), res: ok },
  'folder:delete': { req: z.object({ id, mode: z.enum(['move', 'drop']) }), res: ok },
  'file:defaultExportPath': { req: z.object({ format: exportFormat }), res: z.object({ path: z.string() }) },
  'file:chooseSave': { req: z.object({ format: exportFormat, current: filePath }), res: z.object({ path: z.string().nullable() }) },
  'file:chooseOpen': { req: z.object({}), res: z.object({ path: z.string().nullable() }) },
  'file:inspect': { req: z.object({ path: filePath }), res: any },
  'vault:export': {
    req: z.object({ folderIds: z.array(id).min(1), format: exportFormat, password: filePassword, pin, path: filePath }),
    res: z.object({ path: z.string(), count: z.number() })
  },
  'vault:importPreview': { req: z.object({ path: filePath, password: filePassword }), res: any },
  'vault:importApply': {
    req: z.object({ path: filePath, password: filePassword, replace: z.array(z.string()), pin }),
    res: z.object({ created: z.number(), replaced: z.number(), interrupted: z.boolean() })
  },
  'vault:wipe': { req: z.object({ pin }), res: z.object({ deleted: z.number(), interrupted: z.boolean() }) },
  'settings:autoLock': { req: z.object({ min: z.number() }), res: ok },
  'settings:claudeSkill': { req: z.object({ enabled: z.boolean() }), res: ok },
  'settings:pinForValues': { req: z.object({ enabled: z.boolean(), pin: pin.nullable() }), res: ok }
} as const

export type Channel = keyof typeof contracts
export type ChannelRequest<C extends Channel> = z.infer<(typeof contracts)[C]['req']>

export function isChannel(c: unknown): c is Channel {
  return typeof c === 'string' && Object.hasOwn(contracts, c)
}

export type RpcResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }

/** Eventos que main manda a la ventana. */
export type AppEvent = { type: 'locked'; reason: 'manual' | 'idle' | 'windows' } | { type: 'progress'; done: number; total: number }
