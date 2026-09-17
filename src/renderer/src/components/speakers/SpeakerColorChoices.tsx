import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
const choices = [
  '#dc8b9c',
  '#c4b0df',
  '#88c9c0',
  '#c0c985',
  '#e0ad88',
  '#87b9df',
  '#d99ecb',
  '#93c29a',
]
export function SpeakerColorChoices({
  color,
  onChange,
  automatic,
  onAutomatic,
}: {
  color: string
  onChange: (value: string) => void
  automatic?: boolean
  onAutomatic?: () => void
}) {
  const { t } = useTranslation()
  const [hex, setHex] = useState(false)
  const [input, setInput] = useState(color.startsWith('#') ? color : '#aaaaaa')
  return (
    <>
      <div className="identity-palette">
        {onAutomatic && (
          <button
            type="button"
            aria-label={t('speakerIdentity.automatic')}
            aria-pressed={automatic}
            onClick={onAutomatic}
          >
            A
          </button>
        )}
        {choices.map((value) => (
          <button
            type="button"
            key={value}
            style={{ background: value }}
            aria-label={t('transcript.useColor', { color: value })}
            aria-pressed={!automatic && color === value}
            onClick={() => {
              onChange(value)
              setInput(value)
            }}
          />
        ))}
        <button
          type="button"
          className="identity-hex-toggle"
          aria-expanded={hex}
          onClick={() => setHex(!hex)}
        >
          {t('speakerIdentity.hex')}
        </button>
      </div>
      {hex && (
        <div className="identity-hex">
          <input
            aria-label={t('transcript.hexColor')}
            value={input}
            maxLength={7}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            disabled={!/^#[0-9a-f]{6}$/i.test(input)}
            aria-label={t('speakerIdentity.apply')}
            onClick={() => onChange(input.toLowerCase())}
          >
            <Icon name="check" />
          </button>
        </div>
      )}
    </>
  )
}
