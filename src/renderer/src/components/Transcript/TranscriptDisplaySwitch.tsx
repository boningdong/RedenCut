import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorStore } from '../../stores/editor.store'
import { useTranslation } from '../../i18n/useTranslation'
import './SpeechTasks.css'

export function TranscriptDisplaySwitch() {
  const { t } = useTranslation()
  const mode = useTranscriptStore((state) => state.displayMode)
  return (
    <div className="transcript-display-switch" role="group" aria-label={t('speechTasks.display')}>
      {(['continuous', 'speakers'] as const).map((value) => (
        <button
          key={value}
          aria-pressed={mode === value}
          onClick={() => {
            window.getSelection()?.removeAllRanges()
            useEditorStore.getState().setSelection(null)
            useTranscriptStore.getState().setDisplayMode(value)
          }}
        >
          {t(value === 'continuous' ? 'speechTasks.continuous' : 'speechTasks.bySpeaker')}
        </button>
      ))}
    </div>
  )
}
