import { useMemo } from 'react'
import { reconcileSpeakerIdentities } from '@shared/SpeakerIdentityReconciler'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { useTranslation } from '../../i18n/useTranslation'
import { useTimelineStore } from '../../stores/timeline.store'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorHistoryStore } from '../../stores/EditorHistoryStore'
import { unassignedSpeakerKey } from '../../domain/speakerPresentation'
import { SpeakerIdentityControls } from '../speakers/SpeakerIdentityControls'

function UnassignedTag({
  analysis,
  showSource,
}: {
  analysis: RendererSpeechAnalysis
  showSource: boolean
}) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((state) => state.tracks)
  const sourceName = tracks.find((track) =>
    track.clips.some((clip) => clip.audioSourceId === analysis.audioSourceId),
  )?.name
  const key = unassignedSpeakerKey(analysis)
  const hidden = useTranscriptStore((state) => state.hiddenSpeakerKeys.includes(key))
  const label =
    showSource && sourceName
      ? t('transcript.unassignedSource', { name: sourceName })
      : t('transcript.unassignedSpeaker')
  return (
    <div className={`speaker-tag${hidden ? ' is-hidden' : ''}`}>
      <button
        className="speaker-name-button"
        aria-label={t('transcript.show', { name: label })}
        aria-pressed={!hidden}
        onClick={() => {
          window.getSelection()?.removeAllRanges()
          useEditorStore.getState().setSelection(null)
          useTranscriptStore.getState().toggleSpeakerVisibility(key)
        }}
      >
        {label}
      </button>
    </div>
  )
}

export function SpeakerLabels({
  analyses,
  unassignedSourceIds = [],
  onSave,
}: {
  analyses: RendererSpeechAnalysis[]
  isGenerating: boolean
  unassignedSourceIds?: string[]
  onSave?: (expected: SpeakerIdentityCatalog, next: SpeakerIdentityCatalog) => Promise<void>
}) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  const stored = useEditorStore((s) => s.session?.speakerIdentities)
  const hidden = useTranscriptStore((s) => s.hiddenSpeakerKeys)
  const historyError = useEditorHistoryStore((s) => s.error)
  const catalog = useMemo(
    () => reconcileSpeakerIdentities(stored, analyses, tracks),
    [stored, analyses, tracks],
  )
  return (
    <div className="transcript-speaker-labels">
      {analyses
        .filter((a) => unassignedSourceIds.includes(a.audioSourceId))
        .map((a) => (
          <UnassignedTag
            key={unassignedSpeakerKey(a)}
            analysis={a}
            showSource={unassignedSourceIds.length > 1}
          />
        ))}
      <SpeakerIdentityControls
        catalog={catalog}
        analyses={analyses}
        tracks={tracks}
        hiddenSpeakerKeys={hidden}
        onTogglePeople={(ids) => {
          const keys = catalog.people
            .filter((p) => ids.includes(p.id))
            .map(
              (p) =>
                `${p.binding.audioSourceId}:${p.binding.analysisRevisionId}:${p.binding.speakerId}`,
            )
          const allHidden = keys.every((key) => hidden.includes(key))
          window.getSelection()?.removeAllRanges()
          useEditorStore.getState().setSelection(null)
          useTranscriptStore.setState({
            hiddenSpeakerKeys: allHidden
              ? hidden.filter((k) => !keys.includes(k))
              : [...new Set([...hidden, ...keys])],
            selectedTranscriptUnitIds: new Set(),
          })
        }}
        onSave={async (next) => {
          if (!onSave) throw new Error('No project')
          await onSave(catalog, next)
        }}
      />
      {historyError && <span role="alert">{t('speakerIdentity.failed')}</span>}
    </div>
  )
}
