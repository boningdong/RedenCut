import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { APP_NAME } from '../../shared/constants'

/** A CLI override applies to this invocation; it never persists application preferences. */
export function resolveModelsPath({
  modelsPath,
  environment = process.env,
  userData,
  platform = process.platform,
  home = homedir(),
}: {
  modelsPath?: string
  environment?: NodeJS.ProcessEnv
  userData?: string
  platform?: NodeJS.Platform
  home?: string
} = {}): string {
  const appData =
    platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? environment.APPDATA || join(home, 'AppData', 'Roaming')
        : environment.XDG_CONFIG_HOME || join(home, '.config')
  return resolve(
    modelsPath ||
      environment.REDENCUT_MODELS_PATH ||
      join(userData || join(appData, APP_NAME), 'models'),
  )
}
