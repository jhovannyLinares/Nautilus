import { t } from '@shared/i18n'
import { useState } from 'react'
import {
  CHAR_CLASSES,
  type CharClassId,
  generatePassword,
  PASSWORD_DEFAULT_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordOptions,
  strengthOf
} from '@shared/password'
import { StrengthBar } from './ui'

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: PASSWORD_DEFAULT_LENGTH,
  enabled: { upper: true, lower: true, digits: true, symbols: true },
  noAmbiguous: false
}

/** Panel en línea bajo el campo Valor: arma la contraseña y la entrega con «Usar». */
export function PasswordGenerator(props: { replacesValue: boolean; onUse: (password: string) => void }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_OPTIONS))
  const strength = strengthOf(options)

  function updateOptions(change: Partial<PasswordOptions>) {
    const next = { ...options, ...change }
    setOptions(next)
    setPassword(generatePassword(next))
  }

  function toggleClass(id: CharClassId) {
    const activeCount = CHAR_CLASSES.filter((charClass) => options.enabled[charClass.id]).length
    const isLastActive = options.enabled[id] && activeCount === 1
    if (isLastActive) return
    updateOptions({ enabled: { ...options.enabled, [id]: !options.enabled[id] } })
  }

  return (
    <div className="gen" aria-label={t('Generador de contraseñas')}>
      <div className="gen-row">
        <span className="label">{t('LARGO')}</span>
        <input
          className="grow"
          type="range"
          aria-label={t('Largo')}
          min={PASSWORD_MIN_LENGTH}
          max={PASSWORD_MAX_LENGTH}
          value={options.length}
          onChange={(e) => updateOptions({ length: Number(e.target.value) })}
        />
        <span className="mono strong gen-length">{options.length}</span>
      </div>

      <div className="field">
        <span className="label">{t('INCLUYE')}</span>
        <div className="gen-classes">
          {CHAR_CLASSES.map((charClass) => (
            <label key={charClass.id} className="check">
              <input type="checkbox" checked={options.enabled[charClass.id]} onChange={() => toggleClass(charClass.id)} />
              {charClass.label}
              <span className="mono muted small">{charClass.sample}</span>
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={options.noAmbiguous} onChange={(e) => updateOptions({ noAmbiguous: e.target.checked })} />
          {t('Excluir caracteres que se confunden')}
          <span className="mono muted small">0 O l 1 I</span>
        </label>
      </div>

      <div className="gen-preview">
        <span className="mono strong grow gen-password">{password}</span>
        <button className="btn" onClick={() => setPassword(generatePassword(options))}>
          {t('Otra')}
        </button>
        <button className="btn primary" onClick={() => props.onUse(password)}>
          {t('Usar')}
        </button>
      </div>

      <StrengthBar strength={strength} />

      <span className="hint">
        {t('Sin')}{' '}<span className="mono">% ! ^ &amp; | &lt; &gt; " ' $</span>{' '}{t('ni acento grave: rompen la variable en cmd, en un .bat o en PowerShell.')}
      </span>
      {props.replacesValue && <div className="warn-box">{t('Al usarla, el valor actual se reemplaza cuando guardes.')}</div>}
    </div>
  )
}
