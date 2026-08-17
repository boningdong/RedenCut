import { extname } from 'path'
import { APP_FILE_EXT } from '../shared/constants'

interface ApplicationLike {
  requestSingleInstanceLock(): boolean
  quit(): void
  whenReady(): Promise<unknown>
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown
  on(
    event: 'open-file',
    listener: (event: { preventDefault(): void }, path: string) => void,
  ): unknown
  on(event: 'before-quit', listener: () => void): unknown
}

interface ApplicationRuntime {
  isWindowDestroyed(): boolean
  isWindowMinimized(): boolean
  restoreWindow(): void
  focusWindow(): void
  forwardProject(path: string): void
  shutdown(): void
}

interface ApplicationLifecycleDependencies {
  app: ApplicationLike
  preparePrimary?: () => void
  initialize(): Promise<ApplicationRuntime>
}

export function startApplicationLifecycle({
  app,
  preparePrimary,
  initialize,
}: ApplicationLifecycleDependencies): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  preparePrimary?.()

  const queuedProjects: string[] = []
  let runtime: ApplicationRuntime | null = null

  const forward = (path: string) => {
    if (!isProjectPath(path)) return
    if (!runtime) {
      queuedProjects.push(path)
      return
    }
    if (runtime.isWindowDestroyed()) return
    if (runtime.isWindowMinimized()) runtime.restoreWindow()
    runtime.focusWindow()
    runtime.forwardProject(path)
  }

  app.on('second-instance', (_event: unknown, argv: string[]) => {
    argv.filter(isProjectPath).forEach(forward)
  })
  app.on('open-file', (event: { preventDefault(): void }, path: string) => {
    event.preventDefault()
    forward(path)
  })
  app.on('before-quit', () => runtime?.shutdown())

  void app.whenReady().then(async () => {
    runtime = await initialize()
    queuedProjects.splice(0).forEach(forward)
  })
  return true
}

function isProjectPath(path: string): boolean {
  return extname(path).toLowerCase() === APP_FILE_EXT
}
