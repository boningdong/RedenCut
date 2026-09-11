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
import { SpeakerLabels, speakerColor } from './SpeakerLabels'
import './transcript.css'
import { trackPresentationColor } from '../../themes/trackColors'

type SessionSelection = OccurrenceSelection & { workspaceToken: string | undefined }

export function CanonicalTranscriptPanel({
  workspaceControls,
  onGenerate,
  isGenerating,
  generatingStatus,
  analyses,
}: TranscriptPanelProps & { analyses: RendererSpeechAnalysis[] }) {
  const tracks = useTimelineStore((s) => s.tracks)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const setSelection = useEditorStore((s) => s.setSelection)
  const units = useMemo(() => projectTranscript(analyses, tracks), [analyses, tracks])
  const container = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLSpanElement>())
  const [pending, setPending] = useState<SessionSelection | null>(null)
  const [scopeMessage, setScopeMessage] = useState('')
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
        setScopeMessage('The selected clip changed. Select its current text again.')
        return
      }
      useTimelineStore.getState().muteClipRanges(track.id, clip.id, selected.sourceRanges)
      window.getSelection()?.removeAllRanges()
      setSelection(null)
      setPending(null)
      setScopeMessage('')
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
    const color =
      tracks.length > 1
        ? trackPresentationColor(u.track.color)
        : u.speakerId
          ? speakerColor(u.analysis, u.speakerId)
          : undefined
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
            ? 'Punctuation has no audio range'
            : !editable
              ? 'Speech could not be aligned and cannot be edited'
              : u.ambiguous
                ? 'Speaker uncertain · same-track separation unavailable'
                : `${u.track.name} · ${u.outputStart!.toFixed(2)}s${u.partial ? ' · Partial acoustic unit: only the retained audio is editable' : ''}`
        }
        onClick={() => {
          if (editable && window.getSelection()?.isCollapsed)
            getAudioPlayerInstance()?.seekTo(u.outputStart!)
        }}
        className="transcript-unit"
        style={
          {
            textDecoration:
              u.muted && editable
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
            title="Clip boundary cuts this acoustic unit; text is shown as context for the retained audio"
          >
            partial
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
        <span className="feature-title">Transcript</span>
        <span className="panel-count">{tracks.length} tracks</span>
        <div className="toolbar-spacer" />
        <SpeakerLabels
          analyses={analyses.filter((a) =>
            tracks.some((t) => t.clips.some((c) => c.audioSourceId === a.audioSourceId)),
          )}
          isGenerating={isGenerating}
        />
        <div className="transcript-generation">
          {missing.map((t) => (
            <button key={t.id} disabled={isGenerating} onClick={() => onGenerate(t.id)}>
              Generate {t.name}
            </button>
          ))}
          <button disabled={isGenerating} onClick={() => onGenerate()}>
            {isGenerating ? generatingStatus || 'Analyzing…' : 'Re-analyze'}
          </button>
        </div>
      </div>
      {isGenerating && (
        <div role="status" className="transcript-progress">
          {generatingStatus || 'Generating transcript…'}
        </div>
      )}
      <div
        ref={container}
        contentEditable
        suppressContentEditableWarning
        role="region"
        aria-label="Transcript"
        data-testid="canonical-transcript"
        onBeforeInput={(e) => e.preventDefault()}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onKeyDown={keyDown}
        className="transcript-document"
      >
        <TranscriptDialogue units={units} renderUnit={renderUnit} currentTime={currentTime} />
        {!units.length && <p>No transcript in the current timeline.</p>}
      </div>
      <div className="transcript-footer">
        Select text to edit audio · Click speech to seek · Overlap uses aligned audio boundaries
      </div>
      {scopeMessage && (
        <div role="status" className="transcript-confirmation">
          {scopeMessage}
        </div>
      )}
      {pending && (
        <div role="status" className="transcript-confirmation">
          {pending.scopeConflict
            ? 'Selection spans multiple tracks or clip occurrences. Select text from one track and clip to edit its audio.'
            : pending.expanded
              ? `“${pendingText(pending.requestedUnitIds)}” 必须按声学边界扩展为 “${pendingText(pending.resolvedUnitIds)}”。`
              : pending.unalignedUnitIds.length
                ? '选择中包含无法可靠定位的语音，不能执行音频编辑。'
                : '标点没有对应声音，不能单独执行音频编辑。'}
          <div>
            {pending.editable && <button onClick={() => apply(pending)}>确认编辑</button>}
            <button onClick={() => setPending(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  )
}
