import { useState } from 'react'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { Track } from '@shared/project.types'
import { associateSpeakers } from '@shared/SpeakerAssociations'
import { isPersonEditable } from '@shared/SpeakerIdentityReconciler'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import {
  EditIcon,
  identityColor,
  membersFor,
  SourceBadges,
  type IdentityTarget,
} from './SpeakerIdentityPresentation'
import { SpeakerIdentityEditor } from './SpeakerIdentityEditor'
import './SpeakerIdentities.css'

export function SpeakerIdentityControls({
  catalog,
  analyses,
  tracks,
  hiddenSpeakerKeys,
  onTogglePeople,
  onSave,
}: {
  catalog: SpeakerIdentityCatalog
  analyses: RendererSpeechAnalysis[]
  tracks: Track[]
  hiddenSpeakerKeys: string[]
  onTogglePeople: (personIds: string[]) => void
  onSave: (next: SpeakerIdentityCatalog) => Promise<void>
}) {
  const { t } = useTranslation()
  const [manage, setManage] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [editor, setEditor] = useState<{ target: IdentityTarget; anchor: HTMLElement } | null>(null)
  const [drag, setDrag] = useState<IdentityTarget | null>(null)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const targets: IdentityTarget[] = [
    ...catalog.associations.map((a) => ({ kind: 'association' as const, id: a.id })),
    ...catalog.people
      .filter((p) => !catalog.associations.some((a) => a.memberPersonIds.includes(p.id)))
      .map((p) => ({ kind: 'person' as const, id: p.id })),
  ]
  const label = (target: IdentityTarget) =>
    (target.kind === 'person' ? catalog.people : catalog.associations).find(
      (p) => p.id === target.id,
    )?.displayName ?? ''
  const editable = (target: IdentityTarget) =>
    membersFor(catalog, target).every((p) => isPersonEditable(p, analyses))
  const open = (target: IdentityTarget, anchor: HTMLElement) => {
    setEditor({ target, anchor })
    setError(false)
  }
  const editButton = (target: IdentityTarget) => (
    <button
      type="button"
      className="identity-edit-button"
      disabled={saving}
      aria-label={t('speakerIdentity.edit', { name: label(target) })}
      onClick={(event) => open(target, event.currentTarget)}
    >
      <EditIcon />
    </button>
  )
  const treeRow = (target: IdentityTarget) => (
    <div className="identity-tree-row">
      <span
        className={`identity-dot ${target.kind === 'association' ? 'identity-associated' : ''}`}
        style={{ background: identityColor(catalog, target) }}
      />
      <span className="identity-tree-name">
        {label(target)}
        <SourceBadges people={membersFor(catalog, target)} tracks={tracks} />
        {!editable(target) && <small>{t('speakerIdentity.review')}</small>}
      </span>
      {editButton(target)}
    </div>
  )
  return (
    <div className="identity-controls">
      <div className="identity-tags">
        {targets
          .filter((target) =>
            membersFor(catalog, target).some((p) => isPersonEditable(p, analyses)),
          )
          .map((target) => {
            const people = membersFor(catalog, target)
            const hidden = people.every((p) =>
              hiddenSpeakerKeys.includes(
                `${p.binding.audioSourceId}:${p.binding.analysisRevisionId}:${p.binding.speakerId}`,
              ),
            )
            const colors = tracks
              .filter((track) =>
                people.some((p) =>
                  track.clips.some((c) => c.audioSourceId === p.binding.audioSourceId),
                ),
              )
              .map((track) => track.color)
            return (
              <div
                key={target.kind + target.id}
                className={`identity-tag ${hidden ? 'is-hidden' : ''}`}
                draggable={editable(target) && !saving}
                onDragStart={(e) => {
                  setDrag(target)
                  e.dataTransfer.setData('application/x-redencut-speaker', target.id)
                  e.dataTransfer.effectAllowed = 'link'
                }}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => {
                  if (drag && editable(target) && !saving) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'link'
                  }
                }}
                onDrop={(e) => {
                  void (async () => {
                    e.preventDefault()
                    if (
                      !drag ||
                      !editable(target) ||
                      !editable(drag) ||
                      saving ||
                      drag.id === target.id
                    )
                      return
                    setSaving(true)
                    try {
                      await onSave(associateSpeakers(catalog, target, drag, crypto.randomUUID()))
                      setError(false)
                    } catch {
                      setError(true)
                    } finally {
                      setSaving(false)
                      setDrag(null)
                    }
                  })()
                }}
              >
                <span
                  className="identity-track-rail"
                  style={{
                    background:
                      colors.length > 1
                        ? `linear-gradient(${colors.join(',')})`
                        : (colors[0] ?? 'transparent'),
                  }}
                />
                <button
                  type="button"
                  className="identity-tag-label"
                  aria-label={t('transcript.show', { name: label(target) })}
                  aria-pressed={!hidden}
                  onClick={() => onTogglePeople(people.map((p) => p.id))}
                >
                  <span
                    className={`identity-dot ${target.kind === 'association' ? 'identity-associated' : ''}`}
                    style={{ background: identityColor(catalog, target) }}
                  />
                  {label(target)}
                  <SourceBadges people={people} tracks={tracks} />
                </button>
                {editButton(target)}
              </div>
            )
          })}
        <button
          type="button"
          className="identity-manage"
          aria-expanded={manage}
          onClick={() => setManage(!manage)}
        >
          {t('speakerIdentity.manage')}
        </button>
      </div>
      {error && <p role="alert">{t('speakerIdentity.failed')}</p>}
      {manage && (
        <aside
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              setManage(false)
            }
          }}
          className="identity-management"
          aria-label={t('speakerIdentity.manage')}
        >
          <header>
            <strong>{t('speakerIdentity.manage')}</strong>
            <button type="button" aria-label={t('common.cancel')} onClick={() => setManage(false)}>
              <Icon name="close" />
            </button>
          </header>
          <ul role="tree">
            {targets.map((target) => (
              <li
                role="treeitem"
                key={target.kind + target.id}
                aria-expanded={
                  target.kind === 'association' ? expanded.includes(target.id) : undefined
                }
              >
                {target.kind === 'association' ? (
                  <>
                    <div className="identity-tree-parent">
                      <button
                        type="button"
                        aria-label={t(
                          expanded.includes(target.id)
                            ? 'speakerIdentity.collapse'
                            : 'speakerIdentity.expand',
                          { name: label(target) },
                        )}
                        onClick={() =>
                          setExpanded((ids) =>
                            ids.includes(target.id)
                              ? ids.filter((id) => id !== target.id)
                              : [...ids, target.id],
                          )
                        }
                      >
                        <Icon
                          name="chevron"
                          style={{
                            transform: expanded.includes(target.id) ? undefined : 'rotate(-90deg)',
                          }}
                        />
                      </button>
                      {treeRow(target)}
                    </div>
                    {expanded.includes(target.id) && (
                      <ul role="group">
                        {membersFor(catalog, target).map((p) => (
                          <li role="treeitem" key={p.id}>
                            {treeRow({ kind: 'person', id: p.id })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  treeRow(target)
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}
      {editor && (
        <SpeakerIdentityEditor
          key={editor.target.kind + editor.target.id}
          {...editor}
          catalog={catalog}
          analyses={analyses}
          tracks={tracks}
          onSave={onSave}
          onClose={() => {
            if (!document.activeElement?.closest('.identity-editor')) editor.anchor.focus()
            setEditor((current) => (current === editor ? null : current))
          }}
        />
      )}
    </div>
  )
}
