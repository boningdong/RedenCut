import { useState } from 'react'
import type { RendererSpeechAnalysis, SpeakerId } from '@shared/speech.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
const colors = [
  '#60a5fa',
  '#fb923c',
  '#4ade80',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#facc15',
  '#f87171',
]
export function speakerColor(analysis: RendererSpeechAnalysis, id: SpeakerId): string {
  return colors[
    Math.max(
      0,
      analysis.speakers.findIndex((s) => s.id === id),
    ) % colors.length
  ]
}
export function speakerName(analysis: RendererSpeechAnalysis, id?: SpeakerId): string | undefined {
  return id
    ? (analysis.speakerLabelOverrides.find((s) => s.speakerId === id)?.displayName ??
        analysis.speakers.find((s) => s.id === id)?.defaultDisplayName)
    : undefined
}
export function SpeakerLabels({
  analyses,
  isGenerating,
}: {
  analyses: RendererSpeechAnalysis[]
  isGenerating: boolean
}) {
  const session = useEditorStore((s) => s.session)
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)
  const [error, setError] = useState('')
  const rename = async (analysis: RendererSpeechAnalysis, id: SpeakerId) => {
    if (!session || !editing || isGenerating) return
    const displayName = editing.value.trim()
    if (!displayName || displayName === speakerName(analysis, id)) {
      setEditing(null)
      return
    }
    try {
      const updated = await window.electronAPI.speakerLabel.rename({
        workspaceToken: session.workspaceToken,
        revision: session.revision,
        audioSourceId: analysis.audioSourceId,
        analysisRevisionId: analysis.analysisRevisionId,
        speakerId: id,
        displayName,
      })
      useEditorStore.getState().loadSession(updated, true)
      useTranscriptStore.getState().loadAnalyses(updated.speechAnalyses)
      setError('')
      setEditing(null)
    } catch (error) {
      setError((error as Error).message)
    }
  }
  return (
    <>
      {analyses.some((a) => a.speakers.length > 0) && (
        <div className="transcript-speaker-labels">
          {analyses.flatMap((analysis) =>
            analysis.speakers.map((speaker) => {
              const key = `${analysis.audioSourceId}:${analysis.analysisRevisionId}:${speaker.id}`,
                label = speakerName(analysis, speaker.id) ?? ''
              return editing?.key === key ? (
                <span key={key}>
                  <input
                    aria-label={`Rename ${label}`}
                    value={editing.value}
                    autoFocus
                    onChange={(e) => setEditing({ key, value: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(analysis, speaker.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                  <button onClick={() => void rename(analysis, speaker.id)}>Save</button>
                  <button onClick={() => setEditing(null)}>Cancel</button>
                </span>
              ) : (
                <button
                  key={key}
                  disabled={isGenerating}
                  onDoubleClick={() => setEditing({ key, value: label })}
                  title={`Machine label ${speaker.diarizationLabel}. Double-click to rename.`}
                >
                  <span
                    data-testid={`speaker-swatch-${speaker.id}`}
                    style={{ color: speakerColor(analysis, speaker.id) }}
                  >
                    ●
                  </span>{' '}
                  {label}
                </button>
              )
            }),
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="transcript-confirmation">
          {error}
        </div>
      )}
    </>
  )
}
