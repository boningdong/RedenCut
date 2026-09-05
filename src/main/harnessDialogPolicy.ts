import { parseHarnessWindowMode } from '../shared/harnessWindowMode'
import { PublicIpcError } from './ipc/ipcResult'

export function assertNativeDialogAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (
    env.PODCUT_HARNESS_RUN_ID &&
    env.PODCUT_HARNESS_RUN_DIRECTORY &&
    parseHarnessWindowMode(env.PODCUT_HARNESS_WINDOW_MODE) === 'background'
  )
    throw new PublicIpcError('foreground-required')
}
