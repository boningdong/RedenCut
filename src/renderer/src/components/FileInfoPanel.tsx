import type { AudioMetadata } from '@shared/project.types'
import { Icon } from './ui/Icon'

export function FileInfoPanel({
  displayName,
  metadata,
}: {
  displayName: string
  metadata: AudioMetadata
}) {
  const minutes = Math.floor(metadata.durationSeconds / 60)
  const seconds = Math.floor(metadata.durationSeconds % 60)
    .toString()
    .padStart(2, '0')
  return (
    <details className="file-details">
      <summary title={displayName}>
        <Icon name="wave" size={13} />
        <span className="file-details-label">Audio details</span>
        <Icon name="chevron" size={13} />
      </summary>
      <dl>
        <div className="file-details-name">
          <dt>File</dt>
          <dd>{displayName}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {minutes}:{seconds}
          </dd>
        </div>
        <div>
          <dt>Sample rate</dt>
          <dd>{(metadata.sampleRate / 1000).toFixed(1)} kHz</dd>
        </div>
        <div>
          <dt>Channels</dt>
          <dd>
            {metadata.channels === 1
              ? 'Mono'
              : metadata.channels === 2
                ? 'Stereo'
                : `${metadata.channels} channels`}
          </dd>
        </div>
        <div>
          <dt>Codec</dt>
          <dd>{metadata.codec.toUpperCase()}</dd>
        </div>
        {metadata.bitrateKbps > 0 && (
          <div>
            <dt>Bitrate</dt>
            <dd>{metadata.bitrateKbps} kbps</dd>
          </div>
        )}
      </dl>
    </details>
  )
}
