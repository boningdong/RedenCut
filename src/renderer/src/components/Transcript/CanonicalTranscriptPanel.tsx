import { TranscriptPlaybackControls } from './TranscriptPlaybackControls'
import { useTranscriptPlaybackFollow } from './UseTranscriptPlaybackFollow'
import { SpeechTaskPopover } from './SpeechTaskPopover'
import { TranscriptDisplaySwitch } from './TranscriptDisplaySwitch'
import { ContinuousTranscript } from './ContinuousTranscript'
import { hasValidatedTiming } from '../../domain/transcriptReliability'
import { TranscriptStatusFooter } from './TranscriptStatusFooter'
import { useTranslation } from '../../i18n/useTranslation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorStore } from '../../stores/editor.store'
import { projectTranscript, type TranscriptOccurrence } from '../../domain/transcriptProjection'
import {
  resolveTranscriptSelection,
  type OccurrenceSelection,
} from '../../domain/transcriptSelection'
import type { TranscriptPanelProps } from './TranscriptPanel'
import { TranscriptDialogue } from './TranscriptDialogue'
import { CanonicalTranscriptUnit } from './CanonicalTranscriptUnit'
import { SpeakerLabels } from './SpeakerLabels'
import { speakerKey, unassignedSpeakerKey } from '../../domain/speakerPresentation'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import './transcript.css'

type SessionSelection = OccurrenceSelection & { workspaceToken: string | undefined }

export function CanonicalTranscriptPanel({
  onSaveSpeakerIdentities,
  workspaceControls,
  onGenerate,
  onRun,
  isGenerating,
  generatingStatus,
  onCancel,
  analyses,
}: TranscriptPanelProps & { analyses: RendererSpeechAnalysis[] }) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  const setSelection = useEditorStore((s) => s.setSelection)
  const colors = useSpeakerColors()
  const displayMode = useTranscriptStore((s) => s.displayMode)
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
      displayMode === 'continuous'
        ? allUnits
        : allUnits.filter((u) => {
            const speaker = u.speakerId ?? u.contextSpeakerId
            return !hidden.includes(
              speaker ? speakerKey(u.analysis, speaker) : unassignedSpeakerKey(u.analysis),
            )
          }),
    [allUnits, hidden, displayMode],
  )
  const container = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLSpanElement>())
  const jumpToPlayhead = useTranscriptPlaybackFollow(units, container, elements, displayMode)
  const [pending, setPending] = useState<SessionSelection | null>(null)
  useEffect(() => {
    setPending(null)
  }, [displayMode])
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
        if (
          (selected || ownedSelection) &&
          useEditorStore.getState().selection?.origin === 'transcript'
        )
          setSelection(null)
        return
      }
      const { clip, track } = selected.occurrence
      setSelection({
        origin: 'transcript',
        trackId: track.id,
        start:
          clip.outputStart +
          Math.min(...selected.sourceRanges.map((r) => r.start)) -
          clip.sourceStart,
        end:
          clip.outputStart +
          Math.max(...selected.sourceRanges.map((r) => r.end)) -
          clip.sourceStart,
      })
      useTimelineStore.getState().setSelectedTrackId(track.id)
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
        useTranscriptStore.getState().displayMode === 'speakers' &&
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
          .redactTranscriptRange(track.id, selected.clips, selected.sourceRanges[0])
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
    const speaker = u.speakerId ?? u.contextSpeakerId
    return (
      <CanonicalTranscriptUnit
        key={u.id}
        unit={u}
        elements={elements}
        color={
          displayMode === 'speakers' && speaker
            ? colors.get(speakerKey(u.analysis, speaker))
            : undefined
        }
        highlighted={Boolean(
          pending?.occurrence.track.id === u.track.id &&
          pending.clips.some((c) => c.id === u.clip.id) &&
          pending.resolvedUnitIds.includes(u.unit.id),
        )}
      />
    )
  }
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
        <span className="transport-separator" aria-hidden="true" />
        <SpeakerLabels
          toolbarActions={<TranscriptDisplaySwitch />}
          showTags={displayMode === 'speakers'}
          onSave={onSaveSpeakerIdentities}
          analyses={analyses}
          isGenerating={isGenerating}
          unassignedSourceIds={unassignedSourceIds}
        />
        <SpeechTaskPopover
          tracks={tracks}
          analyses={analyses}
          isGenerating={isGenerating}
          onRun={
            onRun ?? ((scope) => onGenerate(scope.kind === 'track' ? scope.trackId : undefined))
          }
        />
      </div>
      <div className="transcript-viewport">
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
          {displayMode === 'continuous' ? (
            <ContinuousTranscript units={units} tracks={tracks} renderUnit={renderUnit} />
          ) : (
            <TranscriptDialogue units={units} tracks={tracks} renderUnit={renderUnit} />
          )}
          {!units.length && (
            <p>
              {t(allUnits.length ? 'transcript.allSpeakersHidden' : 'transcript.emptyTimeline')}
            </p>
          )}
        </div>
        <TranscriptPlaybackControls onJump={jumpToPlayhead} />
      </div>
      <TranscriptStatusFooter
        isGenerating={isGenerating}
        status={generatingStatus}
        textReady={allUnits.some((u) => u.unit.kind === 'speech' && u.outputStart !== null)}
        onCancel={onCancel}
        needsTimingReview={allUnits.some((u) => u.unit.kind === 'speech' && u.outputStart === null)}
      >
        {!isGenerating && analyses.some((analysis) => analysis.diarizationStatus === 'pending') && (
          <div role="status">{t('transcript.pendingSpeakers')}</div>
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
