import { t } from '@shared/i18n'
import { Fragment, useEffect, useState } from 'react'

export interface MenuItem {
  label: string
  keys?: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
}

export interface Menu {
  label: string
  items: MenuItem[]
}

/** Barra de menús de la ventana. Con un menú abierto, pasar el mouse cambia de menú; Escape o un clic afuera lo cierra. */
export function MenuBar(props: { menus: Menu[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (openIndex === null) return
    const close = () => setOpenIndex(null)
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openIndex])

  /** El clic del título no llega a `window`: si llegara, el mismo clic que abre el menú lo cerraría. */
  function toggle(event: React.MouseEvent, index: number) {
    event.stopPropagation()
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <nav className="menubar" aria-label={t('Menú')}>
      {props.menus.map((menu, index) => (
        <div key={menu.label} className="menubar-entry">
          <button
            className={'menubar-title' + (openIndex === index ? ' on' : '')}
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            // como un menú nativo: el clic no se lleva el foco, así no queda el anillo marcado sobre el título
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => toggle(event, index)}
            onMouseEnter={() => openIndex !== null && setOpenIndex(index)}
          >
            {menu.label}
          </button>
          {openIndex === index && (
            <div className="ctx menubar-panel" role="menu">
              {menu.items.map((item) => (
                <Fragment key={item.label}>
                  {item.separatorBefore && <div className="ctx-separator" />}
                  <button role="menuitem" className={item.danger ? 'ctx-danger' : undefined} disabled={item.disabled} onClick={item.onSelect}>
                    {item.label}
                    {item.keys && <span className="ctx-key">{item.keys}</span>}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
