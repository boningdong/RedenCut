interface HarnessApplication {
  setPath(name: 'userData' | 'sessionData' | 'temp', path: string): void
}

export function configureHarnessStartup(app: HarnessApplication, env: NodeJS.ProcessEnv): boolean {
  const directory = env.PODCUT_HARNESS_RUN_DIRECTORY
  const runId = env.PODCUT_HARNESS_RUN_ID
  if (!directory && !runId) return false
  if (
    !directory ||
    !runId ||
    !isAbsolute(directory) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ||
    basename(resolve(directory)) !== runId
  ) {
    throw new Error(
      'INVALID_HARNESS_CONFIGURATION: expected an absolute run directory ending in its UUID',
    )
  }
  const paths = {
    userData: join(directory, 'user-data'),
    sessionData: join(directory, 'session-data'),
    temp: join(directory, 'temporary'),
  } as const
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true })
  for (const [name, path] of Object.entries(paths)) app.setPath(name as keyof typeof paths, path)
  return true
}
import { mkdirSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
