import { useTranslation } from '../../i18n/useTranslation'
import type { PublicMessage } from '@shared/publicMessages'
import { normalizePublicError, publicMessage } from '../../i18n/messages'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TRACK_COLORS } from '@shared/trackColors'
import type { RendererSpeechAnalysis, SpeakerId } from '@shared/speech.types'
import { useTimelineStore } from '../../stores/timeline.store'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import { speakerKey, speakerName, unassignedSpeakerKey } from '../../domain/speakerPresentation'

const choices = [
  '#dc8b9c',
  '#c4b0df',
  '#88c9c0',
  '#c0c985',
  '#e0ad88',
  '#87b9df',
  '#d99ecb',
  '#93c29a',
]

function SpeakerTag({
  analysis,
  id,
  isGenerating,
}: {
  analysis: RendererSpeechAnalysis
  id: SpeakerId
  isGenerating: boolean
}) {
  const { t } = useTranslation()
  const colors = useSpeakerColors()
  const key = speakerKey(analysis, id)
  const label =
    speakerName(analysis, id, (number) => t('transcript.speakerNumber', { number })) ??
    t('transcript.speaker')
  const color = colors.get(key) ?? '#aaaaaa'
  const hidden = useTranscriptStore((s) => s.hiddenSpeakerKeys.includes(key))
  const toggleVisibility = useTranscriptStore((s) => s.toggleSpeakerVisibility)
  const toggle = (key: string) => {
    window.getSelection()?.removeAllRanges()
    useEditorStore.getState().setSelection(null)
    toggleVisibility(key)
  }
  const [editing, setEditing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [name, setName] = useState(label)
  const [draftColor, setDraftColor] = useState(color)
  const [error, setError] = useState<PublicMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beforeClickHidden = useRef(hidden)
  const root = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    if (!choosing && !error) return
    const place = () => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
        top: Math.max(
          8,
          Math.min(rect.bottom + 8, window.innerHeight - (popup.current?.offsetHeight || 220) - 8),
        ),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [choosing, error])
  const cancelClick = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  useEffect(() => {
    if (!choosing && !error) return
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      ) {
        setChoosing(false)
        setError(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setChoosing(false)
        setError(null)
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [choosing, error])
  const save = async (displayName: string, nextColor?: string) => {
    const session = useEditorStore.getState().session
    if (!session || saving || isGenerating) return
    if (!displayName.trim() || displayName.trim().length > 80) {
      setError({ reason: 'speaker-name' })
      return
    }
    if (nextColor && !/^#[0-9a-f]{6}$/i.test(nextColor)) {
      setError({ reason: 'speaker-color' })
      return
    }
    if (
      nextColor &&
      [...colors].some(
        ([other, used]) => other !== key && used.toLowerCase() === nextColor.toLowerCase(),
      )
    ) {
      setError({ reason: 'speaker-color-used' })
      return
    }
    if (
      nextColor &&
      nextColor.toLowerCase() !== color.toLowerCase() &&
      TRACK_COLORS.includes(nextColor.toLowerCase())
    ) {
      setError({ reason: 'speaker-color-reserved' })
      return
    }
    setSaving(true)
    try {
      const updated = await window.electronAPI.speakerLabel.rename({
        workspaceToken: session.workspaceToken,
        revision: session.revision,
        audioSourceId: analysis.audioSourceId,
        analysisRevisionId: analysis.analysisRevisionId,
        speakerId: id,
        displayName: displayName.trim(),
        ...(nextColor ? { color: nextColor.toLowerCase() } : {}),
      })
      const current = useEditorStore.getState().session
      if (current?.workspaceToken !== session.workspaceToken || current.revision > updated.revision)
        return
      useEditorStore.getState().loadSession(updated, true)
      useTranscriptStore.getState().loadAnalyses(updated.speechAnalyses)
      setEditing(false)
      setChoosing(false)
      setError(null)
    } catch (reason) {
      setError(normalizePublicError(reason))
    } finally {
      setSaving(false)
    }
  }
  const disabled = isGenerating || saving
  return (
    <div className={`speaker-tag${hidden ? ' is-hidden' : ''}`} ref={root}>
      <button
        className="speaker-color-button"
        aria-label={t('transcript.changeColor', { name: label })}
        aria-expanded={choosing}
        disabled={disabled}
        title={t('transcript.changeSpeakerColor')}
        onClick={() => {
          cancelClick()
          setDraftColor(color)
          setChoosing(!choosing)
          setError(null)
        }}
      >
        <span data-testid={`speaker-swatch-${id}`} style={{ background: color }} />
      </button>
      {editing ? (
        <form
          className="speaker-rename"
          onSubmit={(e) => {
            e.preventDefault()
            void save(name)
          }}
        >
          <input
            aria-label={t('transcript.rename', { name: label })}
            value={name}
            maxLength={80}
            autoFocus
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false)
                setError(null)
              }
            }}
          />
          <button disabled={disabled}>{t('common.save')}</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <button
          className="speaker-name-button"
          aria-label={t('transcript.show', { name: label })}
          aria-pressed={!hidden}
          disabled={disabled}
          title={t('transcript.machineLabel', {
            label: analysis.speakers.find((s) => s.id === id)?.diarizationLabel ?? '',
          })}
          onClick={(e) => {
            cancelClick()
            if (e.detail === 0) toggle(key)
            else if (e.detail === 1) {
              beforeClickHidden.current = hidden
              timer.current = setTimeout(() => {
                toggle(key)
                timer.current = null
              }, 350)
            }
          }}
          onDoubleClick={() => {
            cancelClick()
            if (
              useTranscriptStore.getState().hiddenSpeakerKeys.includes(key) !==
              beforeClickHidden.current
            )
              toggle(key)
            setName(label)
            setEditing(true)
            setChoosing(false)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault()
              setName(label)
              setEditing(true)
            }
          }}
        >
          {label}
        </button>
      )}
      {(choosing || error) &&
        createPortal(
          <div className="speaker-popover transcript-speaker-labels" ref={popup} style={position}>
            {choosing && (
              <form
                className="speaker-color-popover"
                aria-label={t('transcript.colorFor', { name: label })}
                onSubmit={(e) => {
                  e.preventDefault()
                  void save(
                    speakerName(analysis, id) ??
                      analysis.speakers.find((speaker) => speaker.id === id)!.defaultDisplayName,
                    draftColor,
                  )
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setChoosing(false)
                    setError(null)
                  }
                }}
              >
                <span className="speaker-color-heading">{t('transcript.speakerColor')}</span>
                <div className="speaker-color-choices">
                  {choices.map((choice) => (
                    <button
                      type="button"
                      key={choice}
                      aria-label={t('transcript.useColor', { color: choice })}
                      title={choice}
                      disabled={
                        disabled ||
                        [...colors].some(
                          ([other, used]) => other !== key && used.toLowerCase() === choice,
                        )
                      }
                      style={{ background: choice }}
                      onClick={() => setDraftColor(choice)}
                      aria-pressed={draftColor === choice}
                    />
                  ))}
                </div>
                <label>
                  {t('transcript.hexColor')}{' '}
                  <input
                    aria-label={t('transcript.hexColor')}
                    value={draftColor}
                    maxLength={7}
                    disabled={disabled}
                    onChange={(e) => setDraftColor(e.target.value)}
                  />
                </label>
                <div>
                  <button disabled={disabled}>{t('transcript.applyColor')}</button>
                  <button
                    type="button"
                    onClick={() => {
                      setChoosing(false)
                      setError(null)
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
            {error && (
              <div role="alert" className="speaker-tag-error">
                {publicMessage(t, error)}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

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
  isGenerating,
  unassignedSourceIds = [],
}: {
  unassignedSourceIds?: string[]
  analyses: RendererSpeechAnalysis[]
  isGenerating: boolean
}) {
  return (
    <div className="transcript-speaker-labels">
      {analyses
        .filter((analysis) => unassignedSourceIds.includes(analysis.audioSourceId))
        .map((analysis) => (
          <UnassignedTag
            key={unassignedSpeakerKey(analysis)}
            analysis={analysis}
            showSource={unassignedSourceIds.length > 1}
          />
        ))}
      {analyses.flatMap((analysis) =>
        analysis.speakers.map((speaker) => (
          <SpeakerTag
            key={speakerKey(analysis, speaker.id)}
            analysis={analysis}
            id={speaker.id}
            isGenerating={isGenerating}
          />
        )),
      )}
    </div>
  )
}
