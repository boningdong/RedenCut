import React, { memo, type RefObject } from 'react'
import { trackPresentationColor } from '../../themes/trackColors'
import { seekFromTranscript } from '../../actions/PlaybackActions'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
import { hasValidatedTiming } from '../../domain/transcriptReliability'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { useTranslation } from '../../i18n/useTranslation'

export const CanonicalTranscriptUnit = memo(function CanonicalTranscriptUnit({
  unit: u,
  elements,
  color,
  highlighted,
}: {
  unit: TranscriptOccurrence
  elements: RefObject<Map<string, HTMLSpanElement>>
  color?: string
  highlighted: boolean
}) {
  const { t } = useTranslation()
  const editable = u.unit.kind === 'speech' && u.outputStart !== null
  // Subscribe to the highlight boundary, not every clock tick: PCM refill shares this thread.
  const current = usePlaybackStore(
    (state) =>
      editable &&
      !u.muted &&
      state.currentTime >= u.outputStart! &&
      state.currentTime < u.outputEnd!,
  )
  return (
    <span
      ref={(element) => {
        if (element) elements.current.set(u.id, element)
        else elements.current.delete(u.id)
      }}
      data-occurrence-id={u.id}
      data-unit-id={u.unit.id}
      data-track-id={u.track.id}
      data-clip-id={u.clip.id}
      data-unit-kind={u.unit.kind}
      data-acoustic-editable={editable}
      data-timing-origin={u.timingOrigin}
      data-acoustic-unit-size={u.acousticUnitSize}
      data-current={current}
      data-playing={current}
      data-partial={u.partial}
      data-redaction={u.redaction ?? 'none'}
      data-output-start={u.outputStart ?? undefined}
      data-output-end={u.outputEnd ?? undefined}
      data-speaker-id={u.speakerId}
      title={
        u.redaction === 'partial'
          ? t('transcript.partiallyRedactedHint')
          : u.unit.kind === 'punctuation'
            ? t('transcript.punctuationHint')
            : !hasValidatedTiming(u.analysis)
              ? t('transcript.unverifiedHint')
              : !editable
                ? t('transcript.unalignedHint')
                : u.ambiguous
                  ? t('transcript.uncertainHint')
                  : t(
                      u.partial
                        ? 'transcript.partialUnitHint'
                        : u.timingOrigin === 'anchor-inferred' ||
                            u.timingOrigin === 'group-fallback'
                          ? 'transcript.estimatedUnitHint'
                          : (u.acousticUnitSize ?? 1) > 1
                            ? 'transcript.groupedUnitHint'
                            : 'transcript.unitHint',
                      {
                        name: u.track.name,
                        seconds: u.outputStart!.toFixed(2),
                      },
                    )
      }
      onClick={() => {
        if (editable && window.getSelection()?.isCollapsed) seekFromTranscript(u.outputStart!)
      }}
      className="transcript-unit"
      style={
        {
          textDecoration:
            u.redaction === 'full' && editable
              ? 'line-through'
              : u.redaction === 'partial' && editable
                ? 'underline dashed'
                : !editable && u.unit.kind === 'speech'
                  ? 'underline dotted'
                  : current
                    ? 'underline'
                    : 'none',
          opacity: u.muted && editable ? 0.5 : u.unit.kind === 'punctuation' ? 0.65 : 1,
          background: highlighted
            ? 'var(--color-warning-muted)'
            : current
              ? 'var(--color-accent-subtle)'
              : u.replacement
                ? `color-mix(in srgb, ${trackPresentationColor(u.track.color)} 18%, transparent)`
                : undefined,
          color: undefined,
          '--track-color': color,
          borderBottom: current && color ? `2px solid ${color}` : undefined,
        } as React.CSSProperties
      }
    >
      {u.leadingSpace ? ' ' : ''}
      {u.unit.text}
      {u.partial && (
        <sup
          contentEditable={false}
          className="transcript-partial-label"
          title={t('transcript.partialHint')}
        >
          {t('transcript.partial')}
        </sup>
      )}
    </span>
  )
})
