import { hasValidatedTiming } from '../../domain/transcriptReliability'
import { TranscriptStatusFooter } from './TranscriptStatusFooter'
import { useTranslation } from '../../i18n/useTranslation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorStore } from '../../stores/editor.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { projectTranscript, type TranscriptOccurrence } from '../../domain/transcriptProjection'
import {
  resolveTranscriptSelection,
  type OccurrenceSelection,
} from '../../domain/transcriptSelection'
import type { TranscriptPanelProps } from './TranscriptPanel'
import { TranscriptDialogue } from './TranscriptDialogue'
import { SpeakerLabels } from './SpeakerLabels'
import { speakerKey, unassignedSpeakerKey } from '../../domain/speakerPresentation'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import './transcript.css'

type SessionSelection = OccurrenceSelection & { workspaceToken: string | undefined }

export function CanonicalTranscriptPanel({
  workspaceControls,
  onGenerate,
  onRegenerate,
  isGenerating,
  generatingStatus,
  onCancel,
  analyses,
}: TranscriptPanelProps & { analyses: RendererSpeechAnalysis[] }) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const setSelection = useEditorStore((s) => s.setSelection)
  const colors = useSpeakerColors()
  const hidden = useTranscriptStore((s) => s.hiddenSpeakerKeys)
  const allUnits = useMemo(() => projectTranscript(analyses, tracks), [analyses, tracks])
  const unassignedSourceIds = useMemo(
    () => [
      ...new Set(
        allUnits
          .filter((u) => !u.speakerId && !u.contextSpeakerId)
          .map((u) => u.analysis.audioSourceId),
      ),
    ],
    [allUnits],
  )
  const units = useMemo(
    () =>
      allUnits.filter((u) => {
        const speaker = u.speakerId ?? u.contextSpeakerId
        return !hidden.includes(
          speaker ? speakerKey(u.analysis, speaker) : unassignedSpeakerKey(u.analysis),
        )
      }),
    [allUnits, hidden],
  )
  const container = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLSpanElement>())
  const [pending, setPending] = useState<SessionSelection | null>(null)
  const [scopeMessage, setScopeMessage] = useState<'hiddenSpeaker' | 'changedClip' | null>(null)
  const resolveNative = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (!container.current?.contains(range.commonAncestorContainer)) return null
    const resolved = resolveTranscriptSelection(
      units.filter((u) => {
        const element = elements.current.get(u.id)
        return element ? range.intersectsNode(element) : false
      }),
      tracks,
    )
    return resolved
      ? { ...resolved, workspaceToken: useEditorStore.getState().session?.workspaceToken }
      : null
  }, [units, tracks])
  useEffect(() => {
    const change = () => {
      const selected = resolveNative()
      const ownedSelection = useTranscriptStore.getState().selectedTranscriptUnitIds.size > 0
      useTranscriptStore
        .getState()
        .setSelectedTranscriptUnitIds(new Set(selected?.requestedUnitIds ?? []))
      if (!selected?.editable || !selected.sourceRanges.length) {
        if (selected || ownedSelection) setSelection(null)
        return
      }
      const { clip, track } = selected.occurrence
      useTimelineStore.getState().setSelectedTrackId(track.id)
      setSelection({
        start:
          clip.outputStart +
          Math.min(...selected.sourceRanges.map((r) => r.start)) -
          clip.sourceStart,
        end:
          clip.outputStart +
          Math.max(...selected.sourceRanges.map((r) => r.end)) -
          clip.sourceStart,
      })
    }
    change()
    document.addEventListener('selectionchange', change)
    return () => document.removeEventListener('selectionchange', change)
  }, [resolveNative, setSelection])
  const apply = useCallback(
    (selected: SessionSelection) => {
      if (!selected.editable) return
      const { track, clip, analysis } = selected.occurrence
      if (
        selected.occurrences.some((u) => {
          const speaker = u.speakerId ?? u.contextSpeakerId
          return useTranscriptStore
            .getState()
            .hiddenSpeakerKeys.includes(
              speaker ? speakerKey(u.analysis, speaker) : unassignedSpeakerKey(u.analysis),
            )
        })
      ) {
        setPending(null)
        setScopeMessage('hiddenSpeaker')
        return
      }
      const current = useTimelineStore
        .getState()
        .tracks.find((t) => t.id === track.id)
        ?.clips.find((c) => c.id === clip.id)
      const revision = useTranscriptStore
        .getState()
        .analyses.find((a) => a.audioSourceId === analysis.audioSourceId)?.analysisRevisionId
      if (
        selected.workspaceToken !== useEditorStore.getState().session?.workspaceToken ||
        !current ||
        current.audioSourceId !== clip.audioSourceId ||
        current.sourceStart !== clip.sourceStart ||
        current.sourceEnd !== clip.sourceEnd ||
        current.outputStart !== clip.outputStart ||
        revision !== analysis.analysisRevisionId
      ) {
        setPending(null)
        setScopeMessage('changedClip')
        return
      }
      if (
        !useTimelineStore
          .getState()
          .muteTranscriptRange(track.id, selected.clips, selected.sourceRanges[0])
      ) {
        setPending(null)
        setScopeMessage('changedClip')
        return
      }
      window.getSelection()?.removeAllRanges()
      setSelection(null)
      setPending(null)
      setScopeMessage(null)
    },
    [setSelection],
  )
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if ((event.target as HTMLElement).closest('button, input, select, textarea')) return
    if (event.metaKey || event.ctrlKey) return
    if (event.code === 'Space') {
      event.preventDefault()
      return
    }
    if (['KeyM', 'Delete', 'Backspace'].includes(event.code)) {
      event.preventDefault()
      event.stopPropagation()
      const selected = resolveNative()
      if (!selected) return
      if (selected.expanded || !selected.editable) setPending(selected)
      else apply(selected)
    } else if (event.key.length === 1) event.preventDefault()
  }
  const renderUnit = (u: TranscriptOccurrence) => {
    const editable = u.unit.kind === 'speech' && u.outputStart !== null
    const current =
      editable && !u.muted && currentTime >= u.outputStart! && currentTime < u.outputEnd!
    const highlighted =
      pending?.occurrence.track.id === u.track.id &&
      pending.clips.some((c) => c.id === u.clip.id) &&
      pending.resolvedUnitIds.includes(u.unit.id)
    const speaker = u.speakerId ?? u.contextSpeakerId
    const color = speaker ? colors.get(speakerKey(u.analysis, speaker)) : undefined
    return (
      <span
        key={u.id}
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
        data-output-start={u.outputStart ?? undefined}
        data-output-end={u.outputEnd ?? undefined}
        data-speaker-id={u.speakerId}
        title={
          u.unit.kind === 'punctuation'
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
          if (editable && window.getSelection()?.isCollapsed)
            getAudioPlayerInstance()?.seekTo(u.outputStart!)
        }}
        className="transcript-unit"
        style={
          {
            textDecoration:
              u.clip.muted && editable
                ? 'line-through'
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
  }
  const missing = tracks.filter((t) =>
    t.clips.some((c) => !analyses.some((a) => a.audioSourceId === c.audioSourceId)),
  )
  const pendingText = (ids: string[]) =>
    pending?.occurrence.analysis.transcript.units
      .filter((u) => ids.includes(u.id))
      .map((u) => u.text)
      .join('') ?? ''
  return (
    <div className="canonical-transcript-panel">
      <div className="transcript-controls">
        {workspaceControls}
        <span className="feature-title">{t('transcript.title')}</span>
        <span className="panel-count">{t('common.trackCount', { count: tracks.length })}</span>
        <div className="toolbar-spacer" />
        <SpeakerLabels
          analyses={analyses.filter((a) =>
            tracks.some((t) => t.clips.some((c) => c.audioSourceId === a.audioSourceId)),
          )}
          isGenerating={isGenerating}
          unassignedSourceIds={unassignedSourceIds}
        />
        <div className="transcript-generation">
          {missing.map((track) => (
            <button key={track.id} disabled={isGenerating} onClick={() => onGenerate(track.id)}>
              {t('transcript.generateTrack', { name: track.name })}
            </button>
          ))}
          <button disabled={isGenerating} onClick={() => onGenerate()}>
            {t('transcript.generate')}
          </button>
          {onRegenerate && (
            <button disabled={isGenerating} onClick={onRegenerate}>
              {t('transcript.reanalyze')}
            </button>
          )}
        </div>
      </div>
      <div
        ref={container}
        contentEditable
        suppressContentEditableWarning
        role="region"
        aria-label={t('transcript.title')}
        data-testid="canonical-transcript"
        onBeforeInput={(e) => e.preventDefault()}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={keyDown}
        className="transcript-document"
      >
        <TranscriptDialogue
          units={units}
          tracks={tracks}
          renderUnit={renderUnit}
          currentTime={currentTime}
        />
        {!units.length && (
          <p>{t(allUnits.length ? 'transcript.allSpeakersHidden' : 'transcript.emptyTimeline')}</p>
        )}
      </div>
      <TranscriptStatusFooter
        isGenerating={isGenerating}
        status={generatingStatus}
        textReady={allUnits.some((u) => u.unit.kind === 'speech' && u.outputStart !== null)}
        onCancel={onCancel}
      >
        {!isGenerating && analyses.some((analysis) => analysis.diarizationStatus === 'pending') && (
          <div role="status">{t('transcript.pendingSpeakers')}</div>
        )}

        {allUnits.some((u) => u.unit.kind === 'speech' && u.outputStart === null) && (
          <div className="transcript-review-notice" role="note">
            {t('transcript.needsReview')} · {t('transcript.reviewHint')}
          </div>
        )}
      </TranscriptStatusFooter>
      {scopeMessage && (
        <div role="status" className="transcript-confirmation">
          {t(`transcript.${scopeMessage}`)}
        </div>
      )}
      {pending && (
        <div role="status" className="transcript-confirmation">
          {pending.scopeConflict
            ? t('transcript.scopeConflict')
            : !hasValidatedTiming(pending.occurrence.analysis)
              ? t('transcript.unverifiedHint')
              : pending.expanded
                ? t('transcript.expandedRedaction', {
                    requested: pendingText(pending.requestedUnitIds),
                    resolved: pendingText(pending.resolvedUnitIds),
                  })
                : pending.unalignedUnitIds.length
                  ? t('transcript.unalignedSelection')
                  : t('transcript.punctuationSelection')}
          <div>
            {pending.editable && (
              <button onClick={() => apply(pending)}>{t('transcript.confirmRedaction')}</button>
            )}
            <button onClick={() => setPending(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
