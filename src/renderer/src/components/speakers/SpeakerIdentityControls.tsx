import { useEffect, useState, type ReactNode } from 'react'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { Track } from '@shared/ProjectTypes'
import { associateSpeakers } from '@shared/SpeakerAssociations'
import { isPersonEditable } from '@shared/SpeakerIdentityReconciler'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import {
  EditIcon,
  identityColor,
  membersFor,
  personIsOnTimeline,
  SourceBadges,
  type IdentityTarget,
} from './SpeakerIdentityPresentation'
import { SpeakerIdentityEditor } from './SpeakerIdentityEditor'
import './SpeakerIdentities.css'

export function SpeakerIdentityControls({
  toolbarActions,
  extraTags,
  showTags = true,
  managementDisabled = false,
  catalog,
  analyses,
  tracks,
  hiddenSpeakerKeys,
  onTogglePeople,
  onSave,
}: {
  extraTags?: ReactNode
  showTags?: boolean
  managementDisabled?: boolean
  toolbarActions?: ReactNode
  catalog: SpeakerIdentityCatalog
  analyses: RendererSpeechAnalysis[]
  tracks: Track[]
  hiddenSpeakerKeys: string[]
  onTogglePeople: (personIds: string[]) => void
  onSave: (next: SpeakerIdentityCatalog) => Promise<void>
}) {
  const { t } = useTranslation()
  const [manage, setManage] = useState(false)
  useEffect(() => {
    if (managementDisabled) setManage(false)
  }, [managementDisabled])
  const [expanded, setExpanded] = useState<string[]>([])
  const [editor, setEditor] = useState<{ target: IdentityTarget; anchor: HTMLElement } | null>(null)
  const [drag, setDrag] = useState<IdentityTarget | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const presentMembers = (target: IdentityTarget) =>
    membersFor(catalog, target).filter((person) => personIsOnTimeline(person, tracks))
  const editorPresent = !!editor && presentMembers(editor.target).length > 0
  useEffect(() => {
    if (!editorPresent) setEditor(null)
  }, [editorPresent])
  const targets: IdentityTarget[] = (
    [
      ...catalog.associations.map((a) => ({ kind: 'association' as const, id: a.id })),
      ...catalog.people
        .filter((p) => !catalog.associations.some((a) => a.memberPersonIds.includes(p.id)))
        .map((p) => ({ kind: 'person' as const, id: p.id })),
    ] as IdentityTarget[]
  ).filter((target) => presentMembers(target).length > 0)
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
        {showTags && extraTags}
        {showTags &&
          targets
            .filter((target) => presentMembers(target).some((p) => isPersonEditable(p, analyses)))
            .map((target) => {
              const people = presentMembers(target)
              const hidden = people.every((p) =>
                hiddenSpeakerKeys.includes(
                  `${p.binding.audioSourceId}:${p.binding.analysisRevisionId}:${p.binding.speakerId}`,
                ),
              )
              return (
                <div
                  key={target.kind + target.id}
                  className={`identity-tag ${hidden ? 'is-hidden' : ''} ${dropTarget === target.id ? 'is-drop-target' : ''} ${drag?.id === target.id ? 'is-dragging' : ''}`}
                  draggable={editable(target) && !saving}
                  onDragStart={(e) => {
                    setDropTarget(null)
                    setDrag(target)
                    e.dataTransfer.setData('application/x-redencut-speaker', target.id)
                    e.dataTransfer.effectAllowed = 'link'
                  }}
                  onDragEnd={() => {
                    setDrag(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(e) => {
                    if (
                      drag &&
                      drag.id !== target.id &&
                      editable(drag) &&
                      editable(target) &&
                      !saving
                    ) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'link'
                      setDropTarget(target.id)
                    }
                  }}
                  onDragLeave={(e) => {
                    if (
                      !(e.relatedTarget instanceof Node) ||
                      !e.currentTarget.contains(e.relatedTarget)
                    )
                      setDropTarget(null)
                  }}
                  onDrop={(e) => {
                    setDropTarget(null)
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
                  <button
                    type="button"
                    className="identity-tag-label"
                    aria-label={t('transcript.show', { name: label(target) })}
                    aria-pressed={!hidden}
                    onClick={() => onTogglePeople(people.map((p) => p.id))}
                  >
                    <SourceBadges people={people} tracks={tracks} collapsible />
                    <span
                      className={`identity-dot ${target.kind === 'association' ? 'identity-associated' : ''}`}
                      style={{ background: identityColor(catalog, target) }}
                    />
                    {label(target)}
                  </button>
                  {editButton(target)}
                </div>
              )
            })}
      </div>
      <div className="identity-toolbar-actions">
        {toolbarActions}
        <button
          type="button"
          className="identity-manage"
          disabled={managementDisabled}
          aria-expanded={manage && !managementDisabled}
          onClick={() => setManage(!manage)}
        >
          <Icon name="person" size={14} />
          {t('speakerIdentity.manage')}
        </button>
      </div>
      {error && <p role="alert">{t('speakerIdentity.failed')}</p>}
      {manage && !managementDisabled && (
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
                        {presentMembers(target).map((p) => (
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
      {editor && editorPresent && (
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
