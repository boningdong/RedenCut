import { useTranslation } from '../i18n/useTranslation'
import type { AudioMetadata } from '@shared/ProjectTypes'
import { Icon } from './ui/Icon'

export function FileInfoPanel({
  displayName,
  metadata,
}: {
  displayName: string
  metadata: AudioMetadata
}) {
  const { t } = useTranslation()
  const minutes = Math.floor(metadata.durationSeconds / 60)
  const seconds = Math.floor(metadata.durationSeconds % 60)
    .toString()
    .padStart(2, '0')
  return (
    <details className="file-details">
      <summary title={displayName}>
        <Icon name="wave" size={13} />
        <span className="file-details-label">{t('waveform.details')}</span>
        <Icon name="chevron" size={13} />
      </summary>
      <dl>
        <div className="file-details-name">
          <dt>{t('waveform.file')}</dt>
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>{t('waveform.duration')}</dt>
          <dd>
            {minutes}:{seconds}
          </dd>
        </div>
        <div>
          <dt>{t('waveform.sampleRate')}</dt>
          <dd>{(metadata.sampleRate / 1000).toFixed(1)} kHz</dd>
        </div>
        <div>
          <dt>{t('waveform.channels')}</dt>
          <dd>
            {metadata.channels === 1
              ? t('waveform.mono')
              : metadata.channels === 2
                ? t('waveform.stereo')
                : t('waveform.channelCount', { count: metadata.channels })}
          </dd>
        </div>
        <div>
          <dt>{t('waveform.codec')}</dt>
          <dd>{metadata.codec.toUpperCase()}</dd>
        </div>
        {metadata.bitrateKbps > 0 && (
          <div>
            <dt>{t('waveform.bitrate')}</dt>
            <dd>{metadata.bitrateKbps} kbps</dd>
          </div>
        )}
      </dl>
    </details>
  )
}
