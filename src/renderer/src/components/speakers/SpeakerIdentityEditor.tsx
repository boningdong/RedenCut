import { speakerIdentityEqual } from '@shared/SpeakerIdentityEquality'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { TrackContent } from '@shared/ProjectTypes'
import { setPersonAssociations, setAssociationMembers } from '@shared/SpeakerAssociations'
import { isPersonEditable } from '@shared/SpeakerIdentityReconciler'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import { SpeakerColorChoices } from './SpeakerColorChoices'
import {
  identityColor,
  personIsOnTimeline,
  SourceBadges,
  type IdentityTarget,
  type Person,
} from './SpeakerIdentityPresentation'

export function SpeakerIdentityEditor({
  catalog,
  target,
  anchor,
  analyses,
  tracks,
  onSave,
  onClose,
}: {
  catalog: SpeakerIdentityCatalog
  target: IdentityTarget
  anchor: HTMLElement
  analyses: RendererSpeechAnalysis[]
  tracks: TrackContent[]
  onSave: (next: SpeakerIdentityCatalog) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [initial] = useState(catalog)
  const [draft, setDraft] = useState(catalog)
  const originalGroup = initial.associations.find((a) =>
    target.kind === 'association' ? a.id === target.id : a.memberPersonIds.includes(target.id),
  )
  const [selected, setSelected] = useState(
    (originalGroup?.memberPersonIds ?? []).filter(
      (id) => target.kind === 'association' || id !== target.id,
    ),
  )
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [colorMember, setColorMember] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const entity =
    target.kind === 'person'
      ? draft.people.find((p) => p.id === target.id)!
      : draft.associations.find((a) => a.id === target.id)!
  const affected =
    target.kind === 'person'
      ? [target.id, ...(originalGroup?.memberPersonIds ?? []), ...selected]
      : [...(originalGroup?.memberPersonIds ?? []), ...selected]
  const readonly = affected.some((id) => {
    const p = catalog.people.find((p) => p.id === id)
    return !p || !isPersonEditable(p, analyses)
  })
  // Unrelated background additions are retained when committing this draft.
  const touchedIds = new Set([...affected, target.id])
  const changed =
    initial.people.some(
      (p) =>
        touchedIds.has(p.id) &&
        !speakerIdentityEqual(
          p,
          catalog.people.find((next) => next.id === p.id),
        ),
    ) || !speakerIdentityEqual(initial.associations, catalog.associations)
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.left, window.innerWidth - (popup.current?.offsetWidth ?? 360) - 8),
        ),
        top: Math.max(
          8,
          Math.min(rect.bottom + 8, window.innerHeight - (popup.current?.offsetHeight ?? 480) - 8),
        ),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (popup.current) observer?.observe(popup.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [anchor])
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!saving) onClose()
      }
    }
    document.addEventListener('keydown', handle, true)
    return () => document.removeEventListener('keydown', handle, true)
  }, [onClose, saving])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !saving &&
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        !anchor.contains(event.target)
      )
        onClose()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [anchor, onClose, saving])
  const editPerson = (id: string, patch: Partial<Pick<Person, 'displayName' | 'color'>>) =>
    setDraft((value) => ({
      ...value,
      people: value.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  const setName = (displayName: string) =>
    target.kind === 'person'
      ? editPerson(target.id, { displayName })
      : setDraft((value) => ({
          ...value,
          associations: value.associations.map((a) =>
            a.id === target.id ? { ...a, displayName } : a,
          ),
        }))
  const setColor = (value: string) =>
    target.kind === 'person'
      ? editPerson(target.id, { color: value })
      : setDraft((d) => ({
          ...d,
          associations: d.associations.map((a) =>
            a.id === target.id ? { ...a, color: { mode: 'custom', value } } : a,
          ),
        }))
  const save = async () => {
    if (readonly || changed || saving) return
    const invalidName = (name: string) => !name.trim() || name.trim().length > 80
    if (
      draft.people.some((p) => {
        const old = initial.people.find((value) => value.id === p.id)
        return (
          (p.displayName !== old?.displayName && invalidName(p.displayName)) ||
          (p.color !== old?.color && !/^#[0-9a-f]{6}$/i.test(p.color))
        )
      }) ||
      draft.associations.some(
        (a) =>
          a.displayName !== initial.associations.find((old) => old.id === a.id)?.displayName &&
          invalidName(a.displayName),
      )
    ) {
      setError(t('speakerIdentity.invalid'))
      return
    }
    setSaving(true)
    try {
      let next = {
        ...catalog,
        people: catalog.people.map((p) => {
          const original = initial.people.find((old) => old.id === p.id)
          const edited = draft.people.find((old) => old.id === p.id)
          return original && edited && !speakerIdentityEqual(original, edited)
            ? {
                ...edited,
                displayName:
                  edited.displayName !== original.displayName
                    ? edited.displayName.trim()
                    : edited.displayName,
              }
            : p
        }),
        associations: draft.associations.map((a) => ({
          ...a,
          displayName:
            a.displayName !== initial.associations.find((old) => old.id === a.id)?.displayName
              ? a.displayName.trim()
              : a.displayName,
        })),
      }
      next =
        target.kind === 'person'
          ? setPersonAssociations(next, target.id, selected, crypto.randomUUID())
          : setAssociationMembers(next, target.id, selected)
      await onSave(next)
      onClose()
    } catch {
      setError(t('speakerIdentity.failed'))
    } finally {
      setSaving(false)
    }
  }
  const candidates = draft.people.filter(
    (p) =>
      personIsOnTimeline(p, tracks) &&
      p.id !== target.id &&
      !selected.includes(p.id) &&
      isPersonEditable(p, analyses) &&
      !draft.associations.some(
        (a) =>
          a.memberPersonIds.includes(p.id) &&
          a.memberPersonIds.some((id) => {
            const member = draft.people.find((m) => m.id === id)
            return !member || !isPersonEditable(member, analyses)
          }),
      ),
  )
  const visibleSelected = selected.filter((id) => {
    const person = draft.people.find((p) => p.id === id)
    return person && personIsOnTimeline(person, tracks)
  })
  return createPortal(
    <div
      className="identity-editor"
      role="dialog"
      aria-modal="false"
      aria-label={t('speakerIdentity.edit', { name: entity.displayName })}
      ref={popup}
      style={position}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <strong>
          {t(target.kind === 'person' ? 'speakerIdentity.person' : 'speakerIdentity.association')}
        </strong>
        <button type="button" disabled={saving} aria-label={t('common.cancel')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {readonly && <p className="identity-notice">{t('speakerIdentity.reviewHelp')}</p>}
      {changed && (
        <p role="alert" className="identity-notice">
          {t('speakerIdentity.changed')}
        </p>
      )}
      <fieldset disabled={readonly || changed || saving}>
        <section>
          <h4>{t('speakerIdentity.basic')}</h4>
          <label>
            {t('speakerIdentity.name')}
            <input
              autoFocus
              aria-label={t('speakerIdentity.name')}
              maxLength={80}
              value={entity.displayName}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <SpeakerColorChoices
            color={identityColor(draft, target)}
            onChange={setColor}
            automatic={
              target.kind === 'association' &&
              typeof entity.color !== 'string' &&
              entity.color.mode === 'automatic'
            }
            onAutomatic={
              target.kind === 'association'
                ? () =>
                    setDraft((d) => ({
                      ...d,
                      associations: d.associations.map((a) =>
                        a.id === target.id ? { ...a, color: { mode: 'automatic' } } : a,
                      ),
                    }))
                : undefined
            }
          />
        </section>
        <section>
          <h4>{t('speakerIdentity.members')}</h4>
          {visibleSelected.length === 0 && (
            <p className="identity-notice">{t('speakerIdentity.empty')}</p>
          )}
          {visibleSelected.map((id) => {
            const person = draft.people.find((p) => p.id === id)
            if (!person) return null
            return (
              <div className="identity-member" key={id}>
                <div className="identity-member-row">
                  <button
                    type="button"
                    aria-label={t('speakerIdentity.color', { name: person.displayName })}
                    aria-expanded={colorMember === id}
                    onClick={() => setColorMember(colorMember === id ? null : id)}
                  >
                    <span className="identity-dot" style={{ background: person.color }} />
                  </button>
                  <div className="identity-member-info">
                    {renaming === id ? (
                      <input
                        autoFocus
                        aria-label={t('speakerIdentity.rename', {
                          name:
                            initial.people.find((p) => p.id === id)?.displayName ??
                            person.displayName,
                        })}
                        value={person.displayName}
                        maxLength={80}
                        onChange={(e) => editPerson(id, { displayName: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            setRenaming(null)
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-label={t('speakerIdentity.rename', { name: person.displayName })}
                        onDoubleClick={() => setRenaming(id)}
                        onKeyDown={(e) => {
                          if (['Enter', ' ', 'F2'].includes(e.key)) {
                            e.preventDefault()
                            setRenaming(id)
                          }
                        }}
                      >
                        {person.displayName}
                      </button>
                    )}
                    <SourceBadges people={[person]} tracks={tracks} />
                  </div>
                  <button
                    type="button"
                    aria-label={t('speakerIdentity.remove', { name: person.displayName })}
                    onClick={() => setSelected((ids) => ids.filter((value) => value !== id))}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                {colorMember === id && (
                  <div className="identity-inline-color">
                    <SpeakerColorChoices
                      color={person.color}
                      onChange={(color) => editPerson(id, { color })}
                    />
                  </div>
                )}
              </div>
            )
          })}
          <button
            type="button"
            className="identity-add"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            {t('speakerIdentity.add')}
          </button>
          {adding && (
            <div className="identity-candidates">
              {candidates.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-label={t('speakerIdentity.addPerson', { name: p.displayName })}
                  onClick={() => setSelected((ids) => [...new Set([...ids, p.id])])}
                >
                  <span className="identity-dot" style={{ background: p.color }} />
                  {p.displayName}
                  <SourceBadges people={[p]} tracks={tracks} />
                </button>
              ))}
            </div>
          )}
        </section>
      </fieldset>
      {error && (
        <p role="alert" className="identity-notice">
          {error}
        </p>
      )}
      <footer>
        <button type="button" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" disabled={readonly || changed || saving} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </footer>
    </div>,
    document.body,
  )
}
