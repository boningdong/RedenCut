import type { TFunction } from 'i18next'
import { createTranslator } from '../../shared/i18n/createTranslator'
import { dialog } from 'electron'
import { APP_FILE_EXT, APP_NAME } from '../../shared/constants'
import type { ProjectDialogs } from './ProjectDialogs'

const englishTranslator = createTranslator('en').getFixedT('en')

export function createNativeProjectDialogs(
  getTranslator: () => TFunction = () => englishTranslator,
): ProjectDialogs {
  return {
    async importAudio(window, purpose) {
      const t = getTranslator()
      const result = await dialog.showOpenDialog(window, {
        title: t(purpose === 'recovery' ? 'mediaRecovery.choose' : 'dialogs.importAudio'),
        filters: [
          {
            name: t('dialogs.audioFiles'),
            extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'],
          },
        ],
        properties: ['openFile'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    async saveProject(window) {
      const t = getTranslator()
      const result = await dialog.showSaveDialog(window, {
        title: t('dialogs.saveProject', { appName: APP_NAME }),
        defaultPath: `${t('dialogs.untitled')}${APP_FILE_EXT}`,
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath.endsWith(APP_FILE_EXT)
        ? result.filePath
        : `${result.filePath}${APP_FILE_EXT}`
    },
    async openProject(window) {
      const t = getTranslator()
      const result = await dialog.showOpenDialog(window, {
        title: t('dialogs.openProject', { appName: APP_NAME }),
        properties: ['openDirectory'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    async dirtyProject(window) {
      const t = getTranslator()
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: APP_NAME,
        message: t('dialogs.saveChanges'),
        buttons: [t('dialogs.save'), t('dialogs.discard'), t('common.cancel')],
        defaultId: 0,
        cancelId: 2,
      })
      return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
    },
    async exportAudio(window, format) {
      const t = getTranslator()
      const result = await dialog.showSaveDialog(window, {
        title: t('dialogs.exportAudio'),
        defaultPath: `export.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      })
      return result.canceled || !result.filePath ? null : result.filePath
    },
  }
}

export const nativeProjectDialogs = createNativeProjectDialogs()
