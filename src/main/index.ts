import { app, BrowserWindow, dialog, protocol } from 'electron'
import { join } from 'path'
import { APP_FILE_EXT, APP_NAME } from '../shared/constants'
import { startApplicationLifecycle } from './applicationLifecycle'
import { registerAudioIpc } from './ipc/audio.ipc'
import { registerProjectIpc } from './ipc/project.ipc'
import { registerRenderIpc } from './ipc/render.ipc'
import { registerTranscriptIpc } from './ipc/transcript.ipc'
import { PendingProjectOpenRegistry } from './project/PendingProjectOpenRegistry'
import { ProjectTransitionCoordinator } from './project/ProjectTransitionCoordinator'
import type { ProjectSwitchSender } from './project/SessionSwitchBarrier'
import { SessionSwitchBarrier } from './project/SessionSwitchBarrier'
import { SessionJobRegistry } from './project/SessionJobRegistry'
import { WorkspaceController } from './project/WorkspaceController'
import { createCacheProtocolHandler } from './protocol/cacheProtocol'
import { createFileRangeResponse } from './protocol/fileRangeResponse'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    window.webContents.openDevTools()
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function windowFor(sender: ProjectSwitchSender): BrowserWindow {
  return (
    BrowserWindow.getAllWindows().find((window) => window.webContents.id === sender.id) ??
    BrowserWindow.getFocusedWindow()!
  )
}

startApplicationLifecycle({
  app,
  preparePrimary: () => {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'podcut', privileges: { secure: true, supportFetchAPI: true, stream: true } },
    ])
  },
  initialize: async () => {
    const controller = new WorkspaceController()
    await controller.initialize(app.getPath('temp'))
    const jobs = new SessionJobRegistry()
    const barrier = new SessionSwitchBarrier()
    const pendingOpens = new PendingProjectOpenRegistry()
    const transitions = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier,
      chooseDirtyAction: async (sender) => {
        const result = await dialog.showMessageBox(windowFor(sender), {
          type: 'question',
          title: APP_NAME,
          message: 'Save changes before opening another project?',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        })
        return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
      },
      chooseSaveDestination: async (sender) => {
        const result = await dialog.showSaveDialog(windowFor(sender), {
          title: `Save ${APP_NAME} Project`,
          defaultPath: `Untitled${APP_FILE_EXT}`,
        })
        if (result.canceled || !result.filePath) return null
        return result.filePath.endsWith(APP_FILE_EXT)
          ? result.filePath
          : `${result.filePath}${APP_FILE_EXT}`
      },
      chooseOpenDestination: async (sender) => {
        const result = await dialog.showOpenDialog(windowFor(sender), {
          title: `Open ${APP_NAME} Project`,
          properties: ['openDirectory'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
    })
    registerProjectIpc(controller, transitions, pendingOpens, barrier)
    registerAudioIpc(controller, jobs)
    registerTranscriptIpc(controller, jobs)
    registerRenderIpc(controller, jobs)
    protocol.handle(
      'podcut',
      createCacheProtocolHandler(
        () => ({ root: controller.workspace.root, project: controller.workspace.project }),
        createFileRangeResponse,
      ),
    )

    let window = createWindow()
    let rendererLoaded = false
    const forwardedProjects: string[] = []
    const flushForwardedProjects = () => {
      if (!rendererLoaded || window.isDestroyed()) return
      forwardedProjects.splice(0).forEach((path) => {
        const pending = pendingOpens.issue(window.webContents.id, path)
        window.webContents.send('project:pending-open', pending)
      })
    }
    const observeRendererLoad = () => {
      rendererLoaded = false
      window.webContents.once('did-finish-load', () => {
        rendererLoaded = true
        flushForwardedProjects()
      })
    }
    observeRendererLoad()
    app.on('activate', () => {
      if (!window.isDestroyed()) return
      window = createWindow()
      observeRendererLoad()
    })
    return {
      isWindowDestroyed: () => window.isDestroyed(),
      isWindowMinimized: () => window.isMinimized(),
      restoreWindow: () => window.restore(),
      focusWindow: () => window.focus(),
      forwardProject: (path: string) => {
        forwardedProjects.push(path)
        flushForwardedProjects()
      },
      shutdown: () => barrier.shutdown(),
    }
  },
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
