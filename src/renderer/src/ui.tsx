import { t } from '@shared/i18n'
import { useEffect, useRef, type ReactNode } from 'react'
import { PIN_DIGITS } from '@shared/names'
import { STRENGTH_SEGMENTS, type Strength } from '@shared/password'
import type { FolderView } from '@shared/view'
import logo from '../../../resources/logo.png'

/** Elegir carpeta con botones de color: lo usan Nueva/Editar variable y Mover a carpeta. */
export function FolderChips(props: { folders: FolderView[]; selected: string; onSelect: (folderId: string) => void }) {
  return (
    <div className="chips">
      {props.folders.map((folder) => (
        <button key={folder.id} className={'chip' + (folder.id === props.selected ? ' on' : '')} onClick={() => props.onSelect(folder.id)}>
          <span className="dot" style={{ background: folder.color }} />
          {folder.name}
        </button>
      ))}
    </div>
  )
}

/** El foco quedó en el fondo de la página: nadie recibe lo que se teclea. */
function focusIsLost(): boolean {
  return !document.activeElement || document.activeElement === document.body
}

/**
 * Mantiene el foco en el campo mientras esté en pantalla: al aparecer, al volver a la ventana desde otra app y
 * tras un clic en una zona que no recibe foco (texto, fondo del diálogo). No le quita el foco a otro campo o botón.
 */
function useKeepFocus(ref: React.RefObject<HTMLInputElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const refocus = () => {
      if (focusIsLost()) ref.current?.focus()
    }
    ref.current?.focus()
    window.addEventListener('focus', refocus)
    document.addEventListener('mouseup', refocus)
    return () => {
      window.removeEventListener('focus', refocus)
      document.removeEventListener('mouseup', refocus)
    }
  }, [ref, enabled])
}

/**
 * Avisa una vez cuando el PIN llega a sus dígitos. Va en un efecto, no en onChange, para que quien recibe el aviso
 * ya tenga el PIN completo en su estado; solo depende del valor para no repetir el aviso en otros renders.
 */
function useOnComplete(value: string, onComplete: (() => void) | undefined): void {
  const latestOnComplete = useRef(onComplete)
  latestOnComplete.current = onComplete
  useEffect(() => {
    if (value.length === PIN_DIGITS) latestOnComplete.current?.()
  }, [value])
}

/**
 * Campo de PIN: un input numérico invisible encima de los puntos. Al completar los dígitos llama a `onComplete`
 * (sin Enter); Enter = onSubmit. `autoFocus` = campo principal; `inputRef` permite pasarle el foco desde afuera.
 */
export function PinInput(props: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  onComplete?: () => void
  error?: boolean
  autoFocus?: boolean
  label?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = props.inputRef ?? ownRef
  useKeepFocus(ref, !!props.autoFocus)
  useOnComplete(props.value, props.onComplete)
  return (
    <div className="pin" onClick={() => ref.current?.focus()}>
      {props.label && <span className="label">{props.label}</span>}
      <div className="pin-dots">
        {Array.from({ length: PIN_DIGITS }, (_, i) => (
          <span key={i} className={'pin-dot' + (i < props.value.length ? ' on' : '') + (i === props.value.length ? ' next' : '') + (props.error ? ' err' : '')} />
        ))}
        <input
          ref={ref}
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_DIGITS}
          value={props.value}
          aria-label={props.label ?? 'PIN'}
          onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_DIGITS))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') props.onSubmit?.()
          }}
        />
      </div>
    </div>
  )
}

/** Diálogo modal con la cabecera del Escudo. Escape = cerrar. */
export function Dialog(props: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [props])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" style={{ maxWidth: props.width ?? 520 }} role="dialog" aria-label={props.title}>
        <div className="dialog-head">
          <img src={logo} width={18} height={18} alt="" />
          <span className="dialog-title">{props.title}</span>
          <button className="dialog-x" onClick={props.onClose} aria-label={t('Cerrar')}>
            ×
          </button>
        </div>
        <div className="dialog-body">{props.children}</div>
        <div className="dialog-foot">{props.footer}</div>
      </div>
    </div>
  )
}

/** Barra de fortaleza en segmentos, con la etiqueta y los bits: la usan Generar y la contraseña del archivo. */
export function StrengthBar(props: { strength: Strength }) {
  const { strength } = props
  return (
    <div className="gen-row">
      <div className="gen-segments">
        {Array.from({ length: STRENGTH_SEGMENTS }, (_, index) => (
          <span key={index} className="gen-segment" style={index < strength.filledSegments ? { background: strength.color } : undefined} />
        ))}
      </div>
      <span className="strong" style={{ color: strength.color }}>
        {strength.label}
      </span>
      <span className="muted small">· {strength.bits} bits</span>
    </div>
  )
}

export function ErrorLine(props: { text: string | null }) {
  return props.text ? <div className="error-line">{props.text}</div> : null
}
