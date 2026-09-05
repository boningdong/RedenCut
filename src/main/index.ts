import { app, BrowserWindow, dialog, protocol } from 'electron'
import { join } from 'path'
import { APP_FILE_EXT, APP_NAME } from '../shared/constants'
import { startApplicationLifecycle } from './applicationLifecycle'
import { configureHarnessStartup } from './harnessStartup'
import { harnessWindowOptions, presentHarnessWindow } from './harnessWindow'
import { parseHarnessWindowMode } from '../shared/harnessWindowMode'
import { assertNativeDialogAllowed } from './harnessDialogPolicy'
import { ExportCoordinator } from './audio/export/ExportCoordinator'
import { registerAudioIpc } from './ipc/audio.ipc'
import { registerProjectIpc } from './ipc/project.ipc'
import { registerRenderIpc } from './ipc/render.ipc'
import { registerTranscriptIpc } from './ipc/transcript.ipc'
import {
  PendingProjectOpenRegistry,
  removePendingProjectOpensOnSenderDestroyed,
} from './project/PendingProjectOpenRegistry'
import { CleanupWarningStore } from './project/CleanupWarningSink'
import { ProjectMutationCoordinator } from './project/ProjectMutationCoordinator'
import { ProjectTransitionCoordinator } from './project/ProjectTransitionCoordinator'
import type { ProjectSwitchSender } from './project/SessionSwitchBarrier'
import { SessionSwitchBarrier } from './project/SessionSwitchBarrier'
import { SessionJobRegistry } from './project/SessionJobRegistry'
import { WorkspaceController } from './project/WorkspaceController'
import { createCacheProtocolHandler } from './protocol/cacheProtocol'
import { createFileRangeResponse } from './protocol/fileRangeResponse'

// Isolation must precede the single-instance lock and all workspace initialization.
const harnessMode = configureHarnessStartup(app, process.env)
const windowMode = harnessMode
  ? parseHarnessWindowMode(process.env.PODCUT_HARNESS_WINDOW_MODE)
  : undefined
if (windowMode === 'background' && process.platform === 'darwin')
  app.setActivationPolicy('accessory')

function createWindow(): BrowserWindow {
  const harnessOptions = harnessWindowOptions(windowMode)
  const window = new BrowserWindow({
    ...harnessOptions,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      ...harnessOptions.webPreferences,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  if (process.env['ELECTRON_RENDERER_URL'] && !harnessMode) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
    window.webContents.openDevTools()
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  presentHarnessWindow(window, windowMode)
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
    const cleanupWarnings = new CleanupWarningStore()
    const controller = new WorkspaceController(undefined, cleanupWarnings)
    await controller.initialize(app.getPath('temp'))
    const jobs = new SessionJobRegistry()
    const mutations = new ProjectMutationCoordinator(controller, jobs)
    const barrier = new SessionSwitchBarrier()
    const pendingOpens = new PendingProjectOpenRegistry()
    const transitions = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier,
      chooseDirtyAction: async (sender) => {
        assertNativeDialogAllowed()
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
        assertNativeDialogAllowed()
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
        assertNativeDialogAllowed()
        const result = await dialog.showOpenDialog(windowFor(sender), {
          title: `Open ${APP_NAME} Project`,
          properties: ['openDirectory'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
    })
    registerProjectIpc(controller, transitions, pendingOpens, barrier, mutations)
    registerAudioIpc(controller, jobs)
    registerTranscriptIpc(controller, jobs)
    registerRenderIpc(
      controller,
      jobs,
      console.error,
      new ExportCoordinator({ cleanupWarningSink: cleanupWarnings }),
    )
    protocol.handle(
      'podcut',
      createCacheProtocolHandler(
        () => ({ root: controller.workspace.root, project: controller.workspace.project }),
        createFileRangeResponse,
      ),
    )

    let window = createWindow()
    let rendererLoaded = false
    let rendererLoad: Promise<void> = Promise.resolve()
    const observeRendererLoad = () => {
      rendererLoaded = false
      removePendingProjectOpensOnSenderDestroyed(pendingOpens, window.webContents)
      rendererLoad = new Promise<void>((resolve) => {
        window.webContents.once('did-finish-load', () => {
          rendererLoaded = true
          resolve()
        })
        window.webContents.once('destroyed', resolve)
      })
    }
    const ensureWindow = async () => {
      if (window.isDestroyed()) {
        window = createWindow()
        observeRendererLoad()
      }
      await rendererLoad
      if (window.isDestroyed() || !rendererLoaded)
        throw new Error('Primary window did not finish loading')
    }
    observeRendererLoad()
    app.on('activate', () => {
      void ensureWindow().catch(console.error)
    })
    return {
      ensureWindow,
      isWindowDestroyed: () => window.isDestroyed(),
      isWindowMinimized: () => window.isMinimized(),
      restoreWindow: () => window.restore(),
      focusWindow: () => window.focus(),
      forwardProject: (path: string) => {
        if (!rendererLoaded || window.isDestroyed())
          throw new Error('Primary window is unavailable')
        const pending = pendingOpens.issue(window.webContents.id, path)
        window.webContents.send('project:pending-open', pending)
      },
      shutdown: () => barrier.shutdown(),
    }
  },
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
