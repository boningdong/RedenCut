// ─────────────────────────────────────────────────────────────────────────────
// FileInfoPanel
//
// Displays metadata returned by FFprobe after a file is opened.
// Shown between the title bar and the waveform area (added in Step 4).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { AudioMetadata } from '@shared/project.types'

interface FileInfoPanelProps {
  displayName: string
  metadata: AudioMetadata
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '4px 12px',
        backgroundColor: 'var(--color-bg-elevated)',
        borderRadius: 6,
        border: '1px solid var(--color-border)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function FileInfoPanel({ displayName, metadata }: FileInfoPanelProps) {
  return (
    <div
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* Filename */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
          fontWeight: 500,
          marginRight: 4,
          flex: '1 1 auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </span>

      {/* Metadata pills */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
        <Pill label="Duration" value={formatDuration(metadata.durationSeconds)} />
        <Pill label="Sample Rate" value={`${(metadata.sampleRate / 1000).toFixed(1)} kHz`} />
        <Pill
          label="Channels"
          value={
            metadata.channels === 1
              ? 'Mono'
              : metadata.channels === 2
                ? 'Stereo'
                : `${metadata.channels}ch`
          }
        />
        <Pill label="Codec" value={metadata.codec.toUpperCase()} />
        {metadata.bitrateKbps > 0 && (
          <Pill label="Bitrate" value={`${metadata.bitrateKbps} kbps`} />
        )}
      </div>
    </div>
  )
}
