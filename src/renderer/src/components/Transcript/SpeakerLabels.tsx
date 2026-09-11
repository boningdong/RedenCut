import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TRACK_COLORS } from '@shared/trackColors'
import type { RendererSpeechAnalysis, SpeakerId } from '@shared/speech.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import { speakerKey, speakerName } from '../../domain/speakerPresentation'

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
  const colors = useSpeakerColors()
  const key = speakerKey(analysis, id)
  const label = speakerName(analysis, id) ?? 'Speaker'
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
  const [error, setError] = useState('')
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
        setError('')
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setChoosing(false)
        setError('')
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
      setError('Use a name between 1 and 80 characters.')
      return
    }
    if (nextColor && !/^#[0-9a-f]{6}$/i.test(nextColor)) {
      setError('Enter a six-digit hex color, such as #dc8b9c.')
      return
    }
    if (
      nextColor &&
      [...colors].some(
        ([other, used]) => other !== key && used.toLowerCase() === nextColor.toLowerCase(),
      )
    ) {
      setError('That color is already used by another speaker.')
      return
    }
    if (
      nextColor &&
      nextColor.toLowerCase() !== color.toLowerCase() &&
      TRACK_COLORS.includes(nextColor.toLowerCase())
    ) {
      setError('That color is reserved for an audio track. Choose another color.')
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
      setError('')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const disabled = isGenerating || saving
  return (
    <div className={`speaker-tag${hidden ? ' is-hidden' : ''}`} ref={root}>
      <button
        className="speaker-color-button"
        aria-label={`Change color for ${label}`}
        aria-expanded={choosing}
        disabled={disabled}
        title="Change speaker color"
        onClick={() => {
          cancelClick()
          setDraftColor(color)
          setChoosing(!choosing)
          setError('')
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
            aria-label={`Rename ${label}`}
            value={name}
            maxLength={80}
            autoFocus
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false)
                setError('')
              }
            }}
          />
          <button disabled={disabled}>Save</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setEditing(false)
              setError('')
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="speaker-name-button"
          aria-label={`Show ${label}`}
          aria-pressed={!hidden}
          disabled={disabled}
          title={`Machine label ${analysis.speakers.find((s) => s.id === id)?.diarizationLabel}. Click to show or hide · Double-click or F2 to rename`}
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
            setError('')
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
                aria-label={`Color for ${label}`}
                onSubmit={(e) => {
                  e.preventDefault()
                  void save(label, draftColor)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setChoosing(false)
                    setError('')
                  }
                }}
              >
                <span className="speaker-color-heading">Speaker color</span>
                <div className="speaker-color-choices">
                  {choices.map((choice) => (
                    <button
                      type="button"
                      key={choice}
                      aria-label={`Use ${choice}`}
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
                  Hex color{' '}
                  <input
                    aria-label="Hex color"
                    value={draftColor}
                    maxLength={7}
                    disabled={disabled}
                    onChange={(e) => setDraftColor(e.target.value)}
                  />
                </label>
                <div>
                  <button disabled={disabled}>Apply color</button>
                  <button
                    type="button"
                    onClick={() => {
                      setChoosing(false)
                      setError('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {error && (
              <div role="alert" className="speaker-tag-error">
                {error}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

export function SpeakerLabels({
  analyses,
  isGenerating,
}: {
  analyses: RendererSpeechAnalysis[]
  isGenerating: boolean
}) {
  return (
    <div className="transcript-speaker-labels">
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
