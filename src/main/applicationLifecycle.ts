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
  ensureWindow(): Promise<void>
  isWindowDestroyed(): boolean
  isWindowMinimized(): boolean
  restoreWindow(): void
  focusWindow(): void
  forwardProject(path: string): void
  shutdown(): void | Promise<void>
}

interface ApplicationLifecycleDependencies {
  app: ApplicationLike
  preparePrimary?: () => void
  initialize(): Promise<ApplicationRuntime>
  reportDiagnostic?: (error: unknown) => void
}

const MAX_PENDING_PROJECTS = 32

export function startApplicationLifecycle({
  app,
  preparePrimary,
  initialize,
  reportDiagnostic = console.error,
}: ApplicationLifecycleDependencies): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  preparePrimary?.()

  const queuedProjects: string[] = []
  let runtime: ApplicationRuntime | null = null
  let draining = false
  let shuttingDown = false
  let shutdownComplete = false
  let shutdownPending = false

  const drain = async () => {
    if (draining || !runtime || shuttingDown) return
    draining = true
    try {
      while (queuedProjects.length > 0 && !shuttingDown) {
        try {
          await runtime.ensureWindow()
          if (shuttingDown) return
          if (runtime.isWindowDestroyed()) throw new Error('Primary window recreation failed')
          if (runtime.isWindowMinimized()) runtime.restoreWindow()
          runtime.focusWindow()
          runtime.forwardProject(queuedProjects.shift()!)
        } catch (error) {
          reportDiagnostic(error)
          return
        }
      }
    } finally {
      draining = false
    }
  }

  const forward = (path: string) => {
    if (!isProjectPath(path) || shuttingDown) return
    if (queuedProjects.length >= MAX_PENDING_PROJECTS) {
      reportDiagnostic(new Error('Pending project-open queue capacity reached'))
      return
    }
    queuedProjects.push(path)
    void drain()
  }

  app.on('second-instance', (_event: unknown, argv: string[]) => {
    argv.filter(isProjectPath).forEach(forward)
  })
  app.on('open-file', (event: { preventDefault(): void }, path: string) => {
    event.preventDefault()
    forward(path)
  })
  app.on('before-quit', (event?: { preventDefault(): void }) => {
    shuttingDown = true
    queuedProjects.splice(0)
    if (shutdownComplete) return
    if (shutdownPending) {
      event?.preventDefault()
      return
    }
    const result = runtime?.shutdown()
    if (result && typeof result.then === 'function') {
      event?.preventDefault()
      shutdownPending = true
      void result.catch(reportDiagnostic).finally(() => {
        shutdownComplete = true
        app.quit()
      })
    } else shutdownComplete = true
  })

  void app
    .whenReady()
    .then(async () => {
      runtime = await initialize()
      await drain()
    })
    .catch(reportDiagnostic)
  return true
}

function isProjectPath(path: string): boolean {
  return extname(path).toLowerCase() === APP_FILE_EXT
}
