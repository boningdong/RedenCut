import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useTranscriptStore } from '../../stores/transcript.store'

type Control = 'follow' | 'jump'
type Feedback = 'followOn' | 'followOff' | 'jumped' | 'noPosition'

export function TranscriptPlaybackControls({ onJump }: { onJump: () => boolean }) {
  const { t } = useTranslation()
  const follow = useTranscriptStore((s) => s.followPlayback)
  const [feedback, setFeedback] = useState<{ control: Control; message: Feedback } | null>(null)
  const [tooltip, setTooltip] = useState<Control | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current)
      clearTimeout(feedbackTimer.current)
    },
    [],
  )
  const hide = () => {
    clearTimeout(hoverTimer.current)
    setTooltip(null)
  }
  const hint = (control: Control) => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setTooltip(control), 600)
  }
  const notify = (control: Control, message: Feedback) => {
    hide()
    clearTimeout(feedbackTimer.current)
    setFeedback({ control, message })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1200)
  }
  return (
    <div
      className="transcript-playback-controls"
      role="group"
      aria-label={t('transcript.playbackNavigation')}
    >
      {(['follow', 'jump'] as const).map((control) => {
        const label = t(
          control === 'follow' ? 'transcript.followPlayback' : 'transcript.jumpToPlayhead',
        )
        return (
          <div className="transcript-playback-control" key={control}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={control === 'follow' ? follow : undefined}
              aria-describedby={tooltip === control && !feedback ? `${id}-${control}` : undefined}
              onMouseEnter={() => hint(control)}
              onMouseLeave={hide}
              onFocus={() => hint(control)}
              onBlur={hide}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  hide()
                  setFeedback(null)
                }
              }}
              onClick={() => {
                if (control === 'follow') {
                  const enabled = !useTranscriptStore.getState().followPlayback
                  useTranscriptStore.getState().setFollowPlayback(enabled)
                  notify(control, enabled ? 'followOn' : 'followOff')
                } else notify(control, onJump() ? 'jumped' : 'noPosition')
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {control === 'follow' ? (
                  <>
                    <path d="M4 5h16M4 11h8M4 17h5" />
                    <path d="m15 11 6 4-6 4z" />
                  </>
                ) : (
                  <>
                    <circle cx="12" cy="12" r="7" />
                    <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
                    <circle cx="12" cy="12" r="1" />
                  </>
                )}
              </svg>
            </button>
            {tooltip === control && !feedback && (
              <span className="transcript-playback-hint" role="tooltip" id={`${id}-${control}`}>
                {label}
              </span>
            )}
            <span
              role={feedback?.control === control ? 'status' : undefined}
              aria-live="polite"
              className={feedback?.control === control ? 'transcript-playback-hint' : undefined}
            >
              {feedback?.control === control ? t(`transcript.${feedback.message}`) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}
