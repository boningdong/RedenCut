import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '@shared/project.types'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { SpeechBatchScope } from '@shared/speechBatch.types'
import { planSpeechTasks, type SpeechTaskSelection } from '@shared/SpeechTaskPlanner'
import { speechSourceStates, speechTargetTracks } from '../../domain/SpeechTaskPresentation'
import { useTranslation } from '../../i18n/useTranslation'
import { SpeechTaskCard } from './SpeechTaskCard'
import { Icon } from '../ui/Icon'
import './SpeechTasks.css'

interface Props {
  tracks: Track[]
  analyses: RendererSpeechAnalysis[]
  isGenerating: boolean
  onRun: (scope: SpeechBatchScope, tasks: SpeechTaskSelection) => void
}
export function SpeechTaskPopover(props: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ top: 0, right: 16 })
  useEffect(() => {
    if (!open) return
    const place = () => {
      const bounds = button.current?.getBoundingClientRect()
      if (bounds)
        setPosition({
          top: Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - 480)),
          right: Math.max(12, window.innerWidth - bounds.right),
        })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  return (
    <>
      <button
        ref={button}
        className="toolbar-outline speech-task-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!props.tracks.some((track) => track.clips.length)}
        onClick={() => setOpen(!open)}
      >
        <Icon name="sparkles" />
        {t('speechTasks.title')}
        <Icon name="chevron" />
      </button>
      {open &&
        createPortal(
          <div
            className="speech-task-overlay"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) close()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                close()
              }
            }}
          >
            <div
              className="speech-task-popover"
              style={position}
              role="dialog"
              aria-modal="true"
              aria-label={t('speechTasks.title')}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') close()
                if (event.key === 'Tab') {
                  const focusable = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
                    ),
                  ]
                  const first = focusable[0],
                    last = focusable[focusable.length - 1]
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault()
                    last?.focus()
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault()
                    first?.focus()
                  }
                }
              }}
            >
              <SpeechTaskForm {...props} onClose={close} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function SpeechTaskForm({
  tracks,
  analyses,
  isGenerating,
  onRun,
  onClose,
}: Props & { onClose: () => void }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<SpeechBatchScope>({ kind: 'all' })
  const defaults = (nextScope: SpeechBatchScope) => {
    const states = speechSourceStates(tracks, analyses, nextScope)
    return {
      text: states.some((source) => !source.text),
      speakers: states.some((source) => !source.speakers),
    }
  }
  const [selected, setSelected] = useState(() => defaults({ kind: 'all' }))
  const [rearmed, setRearmed] = useState({ text: false, speakers: false })
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    select.current?.focus()
  }, [])
  const sources = speechSourceStates(tracks, analyses, scope)
  const tasks: SpeechTaskSelection = {
    text: selected.text ? (rearmed.text ? 'replace' : 'missing') : 'skip',
    speakers: selected.speakers ? (rearmed.speakers ? 'replace' : 'missing') : 'skip',
  }
  const plan = planSpeechTasks(sources, tasks)
  // Completed steps are reuse, not commands, until explicitly rearmed.
  if (!plan.text.length) tasks.text = 'skip'
  if (!plan.speakers.length) tasks.speakers = 'skip'
  const invalidates = sources.some(
    (source) => source.speakers && plan.text.includes(source.audioSourceId),
  )
  const shared =
    scope.kind === 'track' &&
    speechTargetTracks(tracks, [...plan.text, ...plan.speakers]).some(
      (track) => track.id !== scope.trackId,
    )
  const start = () => {
    if (isGenerating || plan.missingText.length || (!plan.text.length && !plan.speakers.length))
      return
    onRun(scope, tasks)
    onClose()
  }
  return (
    <>
      <div className="speech-task-heading">
        <Icon name="sparkles" />
        <strong>{t('speechTasks.title')}</strong>
        <button onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <label htmlFor="speech-task-scope">{t('speechTasks.scope')}</label>
      <select
        ref={select}
        id="speech-task-scope"
        value={scope.kind === 'all' ? '' : scope.trackId}
        disabled={isGenerating}
        onChange={(event) => {
          const nextScope: SpeechBatchScope = event.target.value
            ? { kind: 'track', trackId: event.target.value }
            : { kind: 'all' }
          setScope(nextScope)
          setSelected(defaults(nextScope))
          setRearmed({ text: false, speakers: false })
        }}
      >
        <option value="">{t('speechTasks.allTracks')}</option>
        {tracks.map((track, index) => (
          <option
            key={track.id}
            value={track.id}
            disabled={!track.clips.length}
          >{`T${index + 1} · ${track.name}`}</option>
        ))}
      </select>
      {(['text', 'speakers'] as const).map((phase) => {
        const complete = sources.filter(
          (source) =>
            source[phase] && !(phase === 'speakers' && plan.text.includes(source.audioSourceId)),
        ).length
        return (
          <SpeechTaskCard
            key={phase}
            phase={phase}
            total={sources.length}
            complete={complete}
            selected={selected[phase]}
            rearmed={rearmed[phase]}
            busy={isGenerating}
            targets={speechTargetTracks(tracks, plan[phase])}
            onSelect={(checked) => setSelected((value) => ({ ...value, [phase]: checked }))}
            onRearm={() => {
              setRearmed((value) => ({ ...value, [phase]: true }))
              setSelected((value) => ({ ...value, [phase]: false }))
            }}
            onRestore={() => {
              setRearmed((value) => ({ ...value, [phase]: false }))
              setSelected((value) => ({ ...value, [phase]: true }))
            }}
          />
        )
      })}
      <p
        className={`speech-task-note${plan.missingText.length || invalidates ? ' is-warning' : ''}`}
        role="status"
      >
        {t(
          plan.missingText.length
            ? 'speechTasks.requiresText'
            : invalidates
              ? 'speechTasks.invalidates'
              : plan.text.length && plan.speakers.length
                ? 'speechTasks.sequence'
                : 'speechTasks.skipCompleted',
        )}
      </p>
      {shared && <p className="speech-task-note">{t('speechTasks.sharedSource')}</p>}
      <button
        className="speech-task-start"
        onClick={start}
        disabled={
          isGenerating ||
          !sources.length ||
          !!plan.missingText.length ||
          (!plan.text.length && !plan.speakers.length)
        }
      >
        {t(isGenerating ? 'speechTasks.running' : 'speechTasks.start')}
      </button>
    </>
  )
}
