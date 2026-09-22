import { useCallback, useState } from 'react'
import type { ProjectCommand } from '@shared/ProjectCommands'
import { useTranslation } from '../../i18n/useTranslation'
import { EditorContextMenu } from '../ui/EditorContextMenu'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

export function ProjectMenu({
  name,
  disabled,
  onCommand,
}: {
  name: string
  disabled: boolean
  onCommand(command: ProjectCommand): void
}) {
  const { t } = useTranslation()
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setPoint(null), [])
  return (
    <>
      <Button
        className="project-name"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={Boolean(point)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPoint(point ? null : { x: rect.left, y: rect.bottom + 4 })
        }}
      >
        {name} <Icon name="chevron" />
      </Button>
      {point && (
        <EditorContextMenu
          {...point}
          onClose={close}
          items={[
            { id: 'new', label: t('app.newProject'), action: () => onCommand('new') },
            { id: 'open', label: t('app.openProject'), action: () => onCommand('open') },
            {
              id: 'save',
              label: t('common.save'),
              separator: true,
              action: () => onCommand('save'),
            },
            { id: 'save-as', label: t('app.saveAs'), action: () => onCommand('save-as') },
            {
              id: 'close',
              label: t('app.closeProject'),
              separator: true,
              action: () => onCommand('close'),
            },
          ]}
        />
      )}
    </>
  )
}
