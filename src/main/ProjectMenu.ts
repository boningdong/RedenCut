import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { ProjectCommand } from '../shared/ProjectCommands'
import type { Locale } from '../shared/i18n/locale.types'
import { createTranslator } from '../shared/i18n/createTranslator'

export function installProjectMenu(
  locale: Locale,
  dispatch: (command: ProjectCommand) => void,
  openRecentDiagnostic?: () => void,
): void {
  const t = createTranslator(locale).getFixedT(locale)
  const command = (
    label: string,
    accelerator: string,
    action: ProjectCommand,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => dispatch(action),
  })
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: t('app.fileMenu'),
      submenu: [
        command(t('app.newProject'), 'CmdOrCtrl+N', 'new'),
        command(t('app.openProject'), 'CmdOrCtrl+O', 'open'),
        { type: 'separator' },
        command(t('common.save'), 'CmdOrCtrl+S', 'save'),
        command(t('app.saveAs'), 'CmdOrCtrl+Shift+S', 'save-as'),
        { type: 'separator' },
        command(t('app.closeProject'), 'CmdOrCtrl+W', 'close'),
        ...(process.platform !== 'darwin' ? [{ role: 'quit' as const }] : []),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: locale === 'zh-CN' ? '帮助' : 'Help',
      submenu: [{ label: t('diagnostics.recent'), click: () => openRecentDiagnostic?.() }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
