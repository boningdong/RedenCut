import { createTranslator } from '../shared/i18n/createTranslator'
import { AppPreferencesStore } from './preferences/AppPreferencesStore'
import { registerAppPreferencesIpc } from './ipc/appPreferences.ipc'
import { WorkspaceLayoutStore } from './preferences/WorkspaceLayoutStore'
import { registerWorkspaceLayoutIpc } from './ipc/workspaceLayout.ipc'
import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { createProjectDialogs } from './dialogs/createProjectDialogs'
import { startApplicationLifecycle } from './applicationLifecycle'
import { configureHarnessStartup } from './harnessStartup'
import { routeProjectShortcuts } from './projectShortcutRouting'
import { ExportCoordinator } from './audio/export/ExportCoordinator'
import { registerAudioIpc } from './ipc/audio.ipc'
import { registerProjectIpc } from './ipc/project.ipc'
import { registerRenderIpc } from './ipc/render.ipc'
import { registerTranscriptIpc } from './ipc/transcript.ipc'
import { registerSpeechAnalysisIpc } from './ipc/speechAnalysis.ipc'
import { registerSpeakerLabelIpc } from './ipc/speakerLabel.ipc'
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 15 } } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  routeProjectShortcuts(window.webContents)
  if (process.env['ELECTRON_RENDERER_URL'] && !harnessMode) {
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
      { scheme: 'riffcut', privileges: { secure: true, supportFetchAPI: true, stream: true } },
    ])
  },
  initialize: async () => {
    const appPreferences = new AppPreferencesStore(
      join(app.getPath('userData'), 'app-preferences.json'),
      () => app.getPreferredSystemLanguages(),
    )
    await appPreferences.read().catch(console.error)
    registerAppPreferencesIpc(appPreferences)
    const translators = {
      en: createTranslator('en').getFixedT('en'),
      'zh-CN': createTranslator('zh-CN').getFixedT('zh-CN'),
    }
    const dialogs = createProjectDialogs(
      harnessMode,
      process.env,
      () => translators[appPreferences.getSnapshot().resolvedLocale],
    )
    const cleanupWarnings = new CleanupWarningStore()
    const controller = new WorkspaceController(
      undefined,
      cleanupWarnings,
      harnessMode ? 'create' : 'replace',
    )
    await controller.initialize(app.getPath('temp'))
    const jobs = new SessionJobRegistry()
    const mutations = new ProjectMutationCoordinator(controller, jobs)
    const barrier = new SessionSwitchBarrier()
    const pendingOpens = new PendingProjectOpenRegistry()
    const transitions = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier,
      chooseDirtyAction: (sender) => dialogs.dirtyProject(windowFor(sender)),
      chooseSaveDestination: (sender) => dialogs.saveProject(windowFor(sender)),
      chooseOpenDestination: (sender) => dialogs.openProject(windowFor(sender)),
    })
    registerProjectIpc(
      controller,
      transitions,
      pendingOpens,
      barrier,
      mutations,
      console.error,
      dialogs,
    )
    registerAudioIpc(controller, jobs, console.error, dialogs)
    registerTranscriptIpc(controller, jobs)
    registerSpeechAnalysisIpc(controller, jobs)
    registerSpeakerLabelIpc(controller)
    registerWorkspaceLayoutIpc(
      new WorkspaceLayoutStore(join(app.getPath('userData'), 'workspace-layout.json')),
    )
    registerRenderIpc(
      controller,
      jobs,
      console.error,
      new ExportCoordinator({ cleanupWarningSink: cleanupWarnings }),
      dialogs,
    )
    protocol.handle(
      'riffcut',
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
