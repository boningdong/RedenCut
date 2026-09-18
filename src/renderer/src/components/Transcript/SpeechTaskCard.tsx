import { useTranslation } from '../../i18n/useTranslation'
import { useLocaleStore } from '../../stores/locale.store'
import { whisperModelVariant } from '@shared/WhisperModelPresentation'
import { Fragment } from 'react'
import { Icon } from '../ui/Icon'
import type { speechTargetTracks } from '../../domain/SpeechTaskPresentation'

export function SpeechTaskCard({
  phase,
  complete,
  total,
  selected,
  rearmed,
  busy,
  targets,
  onSelect,
  onRearm,
  onRestore,
}: {
  phase: 'text' | 'speakers'
  complete: number
  total: number
  selected: boolean
  rearmed: boolean
  busy: boolean
  targets: ReturnType<typeof speechTargetTracks>
  onSelect: (checked: boolean) => void
  onRearm: () => void
  onRestore: () => void
}) {
  const { t } = useTranslation()
  const modelId = useLocaleStore((state) => state.whisperModelId)
  const modelVariant = whisperModelVariant(modelId)
  const done = complete === total && total > 0 && !rearmed
  const title = t(phase === 'text' ? 'speechTasks.text' : 'speechTasks.speakers')
  return (
    <div
      className={`speech-task-card${selected && !done ? ' is-selected' : ''}`}
      role="group"
      aria-label={title}
    >
      <div className="speech-task-mark">
        {done ? (
          <span className="speech-task-complete">
            <Icon name="check" />
          </span>
        ) : (
          <input
            type="checkbox"
            aria-label={title}
            checked={selected}
            disabled={busy || total === 0}
            onChange={(event) => onSelect(event.target.checked)}
          />
        )}
      </div>
      <div className="speech-task-content">
        <span>{title}</span>
        <p>
          {phase === 'text' && modelVariant
            ? t('speechTasks.textHelpWithModel', { model: '\uFFFC' })
                .split('\uFFFC')
                .map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && (
                      <span className="speech-task-model" title={t('speechTasks.nextModel')}>
                        Whisper {t(`settings.whisperModels.${modelVariant}`)}
                      </span>
                    )}
                    {part}
                  </Fragment>
                ))
            : t(phase === 'text' ? 'speechTasks.textHelp' : 'speechTasks.speakersHelp')}
        </p>
        {complete > 0 && !rearmed && (
          <small className="speech-task-complete">
            {done ? t('speechTasks.completed') : t('speechTasks.partial', { complete, total })}
          </small>
        )}
        {rearmed && <small>{t('speechTasks.rearmed')}</small>}
        {targets.length > 0 && (
          <div className="speech-task-targets" aria-label={t('speechTasks.targets')}>
            {targets.map((track) => (
              <span
                key={track.id}
                title={`${track.label} · ${track.name}`}
                aria-label={`${track.label} · ${track.name}`}
              >
                {track.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {rearmed ? (
        <button className="speech-task-rerun" disabled={busy} onClick={onRestore}>
          {t('speechTasks.cancelRerun')}
        </button>
      ) : (
        complete > 0 && (
          <button className="speech-task-rerun" disabled={busy} onClick={onRearm}>
            {t(phase === 'text' ? 'speechTasks.retext' : 'speechTasks.respeakers')}
          </button>
        )
      )}
    </div>
  )
}
