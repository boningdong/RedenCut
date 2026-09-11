import { useTranslation } from '../../i18n/useTranslation'
import { progressMessage } from '../../i18n/messages'
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
import { speakerKey } from '../../domain/speakerPresentation'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import './transcript.css'

type SessionSelection = OccurrenceSelection & { workspaceToken: string | undefined }

export function CanonicalTranscriptPanel({
  workspaceControls,
  onGenerate,
  isGenerating,
  generatingStatus,
  analyses,
}: TranscriptPanelProps & { analyses: RendererSpeechAnalysis[] }) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const setSelection = useEditorStore((s) => s.setSelection)
  const colors = useSpeakerColors()
  const hidden = useTranscriptStore((s) => s.hiddenSpeakerKeys)
  const units = useMemo(
    () =>
      projectTranscript(analyses, tracks).filter((u) => {
        const speaker = u.speakerId ?? u.contextSpeakerId
        return !speaker || !hidden.includes(speakerKey(u.analysis, speaker))
      }),
    [analyses, tracks, hidden],
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
    )
    return resolved
      ? { ...resolved, workspaceToken: useEditorStore.getState().session?.workspaceToken }
      : null
  }, [units])
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
      const selectedSpeaker = selected.occurrence.speakerId ?? selected.occurrence.contextSpeakerId
      if (
        selectedSpeaker &&
        useTranscriptStore
          .getState()
          .hiddenSpeakerKeys.includes(speakerKey(analysis, selectedSpeaker))
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
      useTimelineStore.getState().muteClipRanges(track.id, clip.id, selected.sourceRanges)
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
      pending?.occurrence.scopeId === u.scopeId && pending.resolvedUnitIds.includes(u.unit.id)
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
        data-current={current}
        data-playing={current}
        data-partial={u.partial}
        data-output-start={u.outputStart ?? undefined}
        data-output-end={u.outputEnd ?? undefined}
        data-speaker-id={u.speakerId}
        title={
          u.unit.kind === 'punctuation'
            ? t('transcript.punctuationHint')
            : !editable
              ? t('transcript.unalignedHint')
              : u.ambiguous
                ? t('transcript.uncertainHint')
                : t(u.partial ? 'transcript.partialUnitHint' : 'transcript.unitHint', {
                    name: u.track.name,
                    seconds: u.outputStart!.toFixed(2),
                  })
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
        />
        <div className="transcript-generation">
          {missing.map((track) => (
            <button key={track.id} disabled={isGenerating} onClick={() => onGenerate(track.id)}>
              {t('transcript.generateTrack', { name: track.name })}
            </button>
          ))}
          <button disabled={isGenerating} onClick={() => onGenerate()}>
            {isGenerating
              ? generatingStatus
                ? progressMessage(t, generatingStatus)
                : t('transcript.analyzing')
              : t('transcript.reanalyze')}
          </button>
        </div>
      </div>
      {isGenerating && (
        <div role="status" className="transcript-progress">
          {generatingStatus ? progressMessage(t, generatingStatus) : t('transcript.generating')}
        </div>
      )}
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
        <TranscriptDialogue units={units} renderUnit={renderUnit} currentTime={currentTime} />
        {!units.length && <p>{t('transcript.emptyTimeline')}</p>}
      </div>
      <div className="transcript-footer">{t('transcript.editHint')}</div>
      {scopeMessage && (
        <div role="status" className="transcript-confirmation">
          {t(`transcript.${scopeMessage}`)}
        </div>
      )}
      {pending && (
        <div role="status" className="transcript-confirmation">
          {pending.scopeConflict
            ? t('transcript.scopeConflict')
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
