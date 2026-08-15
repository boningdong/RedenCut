import { app, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { registerAudioIpc } from './ipc/audio.ipc'
import { registerProjectIpc } from './ipc/project.ipc'
import { registerRenderIpc } from './ipc/render.ipc'
import { registerTranscriptIpc } from './ipc/transcript.ipc'
import { WorkspaceController } from './project/WorkspaceController'
import { createCacheProtocolHandler } from './protocol/cacheProtocol'
import { createFileRangeResponse } from './protocol/fileRangeResponse'

protocol.registerSchemesAsPrivileged([
  { scheme: 'podcut', privileges: { secure: true, supportFetchAPI: true, stream: true } },
])

function createWindow(): void {
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
}

void app.whenReady().then(async () => {
  const controller = new WorkspaceController()
  await controller.initialize(app.getPath('temp'))
  registerProjectIpc(controller)
  registerAudioIpc(controller)
  registerTranscriptIpc(controller)
  registerRenderIpc(controller)

  protocol.handle(
    'podcut',
    createCacheProtocolHandler(
      () => ({ root: controller.workspace.root, project: controller.workspace.project }),
      createFileRangeResponse,
    ),
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
