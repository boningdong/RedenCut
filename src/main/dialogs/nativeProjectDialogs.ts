import { dialog } from 'electron'
import { APP_FILE_EXT, APP_NAME } from '../../shared/constants'
import type { ProjectDialogs } from './ProjectDialogs'

export const nativeProjectDialogs: ProjectDialogs = {
  async importAudio(window) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import Audio',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'] },
      ],
      properties: ['openFile'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  async saveProject(window) {
    const result = await dialog.showSaveDialog(window, {
      title: `Save ${APP_NAME} Project`,
      defaultPath: `Untitled${APP_FILE_EXT}`,
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath.endsWith(APP_FILE_EXT)
      ? result.filePath
      : `${result.filePath}${APP_FILE_EXT}`
  },
  async openProject(window) {
    const result = await dialog.showOpenDialog(window, {
      title: `Open ${APP_NAME} Project`,
      properties: ['openDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  async dirtyProject(window) {
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      title: APP_NAME,
      message: 'Save changes before opening another project?',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
  },
  async exportAudio(window, format) {
    const result = await dialog.showSaveDialog(window, {
      title: 'Export Audio',
      defaultPath: `export.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    return result.canceled || !result.filePath ? null : result.filePath
  },
}
