import { installProjectMenu } from './ProjectMenu'
import { ProjectCloseGuard } from './project/ProjectCloseGuard'
import { registerPreparedAudioIpc } from './ipc/PreparedAudioIpc'
import { MediaRecoveryCoordinator } from './project/MediaRecoveryCoordinator'
import { MediaRecoveryService } from './project/MediaRecoveryService'
import { registerMediaRecoveryIpc } from './ipc/MediaRecoveryIpc'
import { registerSpeakerIdentityIpc } from './ipc/SpeakerIdentityIpc'
import appIcon from './assets/icons/macos/neon-dark-lavender.xcassets/AppIcon.appiconset/1024-mac.png?asset'
import { DevelopmentEnvironmentChecker } from './runtime/DevelopmentEnvironmentChecker'
import { createModelLoadValidator } from './resources/validateModelLoad'
import { readFile, rm } from 'node:fs/promises'
import { ModelManifestSchema } from '../shared/modelManifest.schema'
import { ResourceManager } from './resources/ResourceManager'
import { managedModelLocation } from './resources/ManagedModelLocation'
import { ModelRegistry } from './resources/ModelRegistry'
import { ModelDownloader } from './resources/ModelDownloader'
import { registerResourcesIpc } from './ipc/resources.ipc'
import { AppRuntimeLocator, configureAppRuntime } from './runtime/AppRuntimeLocator'
import { createTranslator } from '../shared/i18n/createTranslator'
import { AppPreferencesStore } from './preferences/AppPreferencesStore'
import { registerAppPreferencesIpc } from './ipc/appPreferences.ipc'
import { WorkspaceLayoutStore } from './preferences/WorkspaceLayoutStore'
import { registerWorkspaceLayoutIpc } from './ipc/workspaceLayout.ipc'
import { app, BrowserWindow, protocol, ipcMain, dialog } from 'electron'
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
    icon: appIcon,
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
      { scheme: 'redencut', privileges: { secure: true, supportFetchAPI: true, stream: true } },
    ])
  },
  initialize: async () => {
    if (process.platform === 'darwin') app.dock?.setIcon(appIcon)
    const appPreferences = new AppPreferencesStore(
      join(app.getPath('userData'), 'app-preferences.json'),
      () => app.getPreferredSystemLanguages(),
    )
    await appPreferences.read().catch(console.error)
    registerAppPreferencesIpc(appPreferences)
    const runtime = new AppRuntimeLocator({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.isPackaged ? app.getAppPath() : join(__dirname, '../..'),
    })
    configureAppRuntime(runtime)
    const manifestPath = app.isPackaged
      ? join(process.resourcesPath, 'speech-worker', 'models.json')
      : join(__dirname, '../../speech-worker/models.json')
    const manifest = ModelManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    // Retire only the app-owned credential. The developer's HF CLI login is untouched.
    await rm(join(app.getPath('userData'), 'secrets', 'huggingface.token'), { force: true }).catch(
      () => {
        console.warn('Could not remove the retired application credential file.')
      },
    )
    const developmentEnvironment = app.isPackaged
      ? undefined
      : new DevelopmentEnvironmentChecker(runtime)
    const resources = new ResourceManager(
      manifest.models,
      new ModelRegistry(
        app.getPath('userData'),
        managedModelLocation({
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.isPackaged ? app.getAppPath() : join(__dirname, '../..'),
        }),
      ),
      new ModelDownloader(),
      createModelLoadValidator(runtime, manifestPath),
      developmentEnvironment,
      appPreferences,
    )
    registerResourcesIpc(resources)
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
    const mediaRecovery = new MediaRecoveryCoordinator(
      new MediaRecoveryService(),
      (sender) => dialogs.importAudio(windowFor(sender), 'recovery'),
      (senderId, snapshot) => {
        const window = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.id === senderId,
        )
        if (window && !window.webContents.isDestroyed())
          window.webContents.send('media-recovery:changed', snapshot)
      },
    )
    registerMediaRecoveryIpc(mediaRecovery)
    const transitions = new ProjectTransitionCoordinator({
      recoverMedia: (sender, workspace) =>
        mediaRecovery.recover(sender, workspace.root, workspace.project.audioSources),
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
    registerPreparedAudioIpc(controller, jobs)
    registerTranscriptIpc(controller, jobs)
    registerSpeechAnalysisIpc(controller, jobs, console.error, {
      resources,
      preferences: appPreferences,
      runtime,
      manifestPath,
    })
    registerSpeakerLabelIpc(controller)
    registerSpeakerIdentityIpc(controller)
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
      'redencut',
      createCacheProtocolHandler(
        () => ({ root: controller.workspace.root, project: controller.workspace.project }),
        createFileRangeResponse,
      ),
    )

    const closeGuard = new ProjectCloseGuard()
    ipcMain.handle('project:close-response', (event, requestId: unknown, allowed: unknown) =>
      typeof requestId === 'string' && typeof allowed === 'boolean'
        ? closeGuard.respond(event.sender.id, requestId, allowed)
        : false,
    )
    let closeAllowed = false
    let window = createWindow()
    const updateMenu = () =>
      installProjectMenu(appPreferences.getSnapshot().resolvedLocale, (command) => {
        void ensureWindow()
          .then(() => window.webContents.send('project:command', command))
          .catch(console.error)
      })
    appPreferences.subscribe(updateMenu)
    updateMenu()
    const protectWindow = () => {
      window.on('close', (event) => {
        if (closeAllowed) return
        event.preventDefault()
        if (!rendererLoaded) return
        void closeGuard
          .request(window.webContents)
          .then((allowed) => {
            if (!allowed || window.isDestroyed()) return
            closeAllowed = true
            window.close()
          })
          .catch(console.error)
      })
    }
    let rendererLoaded = false
    let rendererFailed = false
    let departure: Promise<boolean> | null = null
    const requestDeparture = (): Promise<boolean> => {
      if (!departure)
        departure = decideDeparture().finally(() => {
          departure = null
        })
      return departure
    }
    const decideDeparture = async (): Promise<boolean> => {
      if (window.isDestroyed()) return true
      if (rendererFailed || window.webContents.isCrashed()) {
        const t = translators[appPreferences.getSnapshot().resolvedLocale]
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          message: t('app.editorUnavailable'),
          detail: t('app.editorUnavailableDetail'),
          buttons: [t('common.cancel'), t('app.closeWithoutSaving')],
          defaultId: 0,
          cancelId: 0,
        })
        return result.response === 1
      }
      return rendererLoaded ? closeGuard.request(window.webContents) : false
    }
    let rendererLoad: Promise<void> = Promise.resolve()
    const observeRendererLoad = () => {
      rendererLoaded = false
      rendererFailed = false
      window.webContents.once('did-fail-load', () => {
        rendererFailed = true
      })
      window.webContents.once('render-process-gone', () => {
        rendererFailed = true
      })
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
        closeAllowed = false
        protectWindow()
        observeRendererLoad()
      }
      await rendererLoad
      if (window.isDestroyed() || !rendererLoaded)
        throw new Error('Primary window did not finish loading')
    }
    observeRendererLoad()
    protectWindow()
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
      canShutdown: async () => {
        if (window.isDestroyed() || closeAllowed) return true
        const allowed = await requestDeparture()
        if (allowed) closeAllowed = true
        return allowed
      },
      shutdown: async () => {
        await Promise.all([developmentEnvironment?.shutdown(), resources.shutdown()])
        await mediaRecovery.shutdown()
        await barrier.shutdown()
      },
    }
  },
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
